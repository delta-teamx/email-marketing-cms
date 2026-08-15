import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import Papa from 'papaparse';
import type { ParseResult } from 'papaparse';
import { CONTACT_STAGES, isValidEmail, normalizeEmail } from '@implenix/shared';
import { fetchAllPages, supabase } from '../lib/supabase';
import { useWorkspace } from '../context/AuthContext';
import { useToast } from '../hooks/toast';
import { EmptyState, ErrorBanner, Pagination, Skeleton } from '../components/ui';
import { fmtDate, fmtNumber, fullName } from '../lib/format';
import type { ContactRow, ContactStage } from '../lib/types';

const PAGE_SIZE = 25;
const BATCH_SIZE = 500;

const CONTACT_FIELDS = [
  'email',
  'first_name',
  'last_name',
  'phone',
  'practice_type',
  'patient_flow',
  'notes',
] as const;
type ContactField = (typeof CONTACT_FIELDS)[number];
type ColumnTarget = ContactField | 'custom' | 'skip';

const FIELD_LABELS: Record<ColumnTarget, string> = {
  email: 'Email',
  first_name: 'First name',
  last_name: 'Last name',
  phone: 'Phone',
  practice_type: 'Practice type',
  patient_flow: 'Patient flow',
  notes: 'Notes',
  custom: 'Custom field',
  skip: 'Ignore column',
};

function guessTarget(header: string): ColumnTarget {
  const h = header.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (/^(e?mail|email_address)$/.test(h)) return 'email';
  if (/^(first_name|firstname|first|given_name)$/.test(h)) return 'first_name';
  if (/^(last_name|lastname|last|surname|family_name)$/.test(h)) return 'last_name';
  if (/^(phone|phone_number|mobile|tel|telephone)$/.test(h)) return 'phone';
  if (/^(practice_type|practice|specialty|speciality)$/.test(h)) return 'practice_type';
  if (/^(patient_flow|patients|patient_volume|volume)$/.test(h)) return 'patient_flow';
  if (/^(notes?|comments?)$/.test(h)) return 'notes';
  return 'custom';
}

interface ParsedCsv {
  fileName: string;
  headers: string[];
  rows: Record<string, string>[];
}

interface ImportReport {
  imported: number;
  invalid: number;
  duplicates: number;
  suppressed: number;
}

export function ContactsPage() {
  const workspace = useWorkspace();
  const toast = useToast();
  const navigate = useNavigate();

  // --- importer ----------------------------------------------------------
  const [importOpen, setImportOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<Record<string, ColumnTarget>>({});
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [report, setReport] = useState<ImportReport | null>(null);

  const resetImporter = () => {
    setParsed(null);
    setMapping({});
    setReport(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onFile = (file: File | null) => {
    if (!file) return;
    setReport(null);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (result: ParseResult<Record<string, string>>) => {
        const headers = (result.meta.fields ?? []).filter((h) => h.trim() !== '');
        if (headers.length === 0 || result.data.length === 0) {
          toast('error', 'That CSV appears to be empty or has no header row.');
          resetImporter();
          return;
        }
        setParsed({ fileName: file.name, headers, rows: result.data });
        const initial: Record<string, ColumnTarget> = {};
        const taken = new Set<ColumnTarget>();
        for (const h of headers) {
          const guess = guessTarget(h);
          if (guess !== 'custom' && taken.has(guess)) {
            initial[h] = 'custom';
          } else {
            initial[h] = guess;
            taken.add(guess);
          }
        }
        setMapping(initial);
      },
      error: (err: Error) => {
        toast('error', `Could not parse CSV: ${err.message}`);
        resetImporter();
      },
    });
  };

  const emailColumns = useMemo(
    () => Object.entries(mapping).filter(([, t]) => t === 'email').map(([h]) => h),
    [mapping],
  );

  const runImport = async () => {
    if (!parsed) return;
    if (emailColumns.length !== 1) {
      toast('error', 'Map exactly one column to Email before importing.');
      return;
    }
    const emailColumn = emailColumns[0];
    setImporting(true);
    setReport(null);
    setProgress({ done: 0, total: 0 });
    try {
      const [existingRows, suppressedRows] = await Promise.all([
        fetchAllPages<{ email: string }>((from, to) =>
          supabase.from('contacts').select('email').eq('workspace_id', workspace.id).range(from, to),
        ),
        fetchAllPages<{ email: string }>((from, to) =>
          supabase
            .from('suppression_list')
            .select('email')
            .eq('workspace_id', workspace.id)
            .range(from, to),
        ),
      ]);
      const existing = new Set(existingRows.map((r) => normalizeEmail(r.email)));
      const suppressed = new Set(suppressedRows.map((r) => normalizeEmail(r.email)));

      const counts: ImportReport = { imported: 0, invalid: 0, duplicates: 0, suppressed: 0 };
      const toInsert: Record<string, unknown>[] = [];
      const seenInFile = new Set<string>();

      for (const row of parsed.rows) {
        const rawEmail = row[emailColumn] ?? '';
        if (!isValidEmail(rawEmail)) {
          counts.invalid++;
          continue;
        }
        const email = normalizeEmail(rawEmail);
        if (seenInFile.has(email) || existing.has(email)) {
          counts.duplicates++;
          continue;
        }
        if (suppressed.has(email)) {
          counts.suppressed++;
          continue;
        }
        seenInFile.add(email);

        const contact: Record<string, unknown> = {
          workspace_id: workspace.id,
          email,
          source: 'csv',
        };
        const custom: Record<string, string> = {};
        for (const header of parsed.headers) {
          if (header === emailColumn) continue;
          const target = mapping[header] ?? 'skip';
          const value = (row[header] ?? '').trim();
          if (!value || target === 'skip') continue;
          if (target === 'custom') custom[header] = value;
          else contact[target] = value;
        }
        if (Object.keys(custom).length > 0) contact.custom_fields = custom;
        toInsert.push(contact);
      }

      setProgress({ done: 0, total: toInsert.length });
      for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
        const batch = toInsert.slice(i, i + BATCH_SIZE);
        const { error } = await supabase.from('contacts').insert(batch);
        if (error) throw new Error(error.message);
        counts.imported += batch.length;
        setProgress({ done: Math.min(i + BATCH_SIZE, toInsert.length), total: toInsert.length });
      }

      setReport(counts);
      setParsed(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      toast(
        'success',
        `Imported ${fmtNumber(counts.imported)} contact${counts.imported === 1 ? '' : 's'}.`,
      );
      setPage(0);
      await loadContacts(0, search);
    } catch (e) {
      toast('error', e instanceof Error ? `Import failed: ${e.message}` : 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  // --- table -------------------------------------------------------------
  const [contacts, setContacts] = useState<ContactRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [tableError, setTableError] = useState<string | null>(null);

  const loadContacts = useCallback(
    async (pageNo: number, query: string) => {
      setTableError(null);
      setContacts(null);
      let req = supabase
        .from('contacts')
        .select('*', { count: 'exact' })
        .eq('workspace_id', workspace.id);
      const q = query.trim().replace(/[,%()]/g, '');
      if (q) {
        req = req.or(
          `email.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%,phone.ilike.%${q}%`,
        );
      }
      const from = pageNo * PAGE_SIZE;
      const { data, count, error } = await req
        .order('created_at', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error) {
        setTableError(error.message);
        setContacts([]);
        return;
      }
      setContacts((data ?? []) as ContactRow[]);
      setTotal(count ?? 0);
    },
    [workspace.id],
  );

  useEffect(() => {
    void loadContacts(page, search);
  }, [loadContacts, page, search]);

  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    setPage(0);
    setSearch(searchDraft);
  };

  const setStage = async (contact: ContactRow, stage: ContactStage) => {
    const { error } = await supabase.from('contacts').update({ stage }).eq('id', contact.id);
    if (error) {
      toast('error', `Could not update stage: ${error.message}`);
    } else {
      toast('success', `${contact.email} moved to ${CONTACT_STAGES.find((s) => s.key === stage)?.name ?? stage}.`);
      setContacts((rows) => (rows ?? []).map((r) => (r.id === contact.id ? { ...r, stage } : r)));
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Contacts</h1>
          <p className="page-sub">
            Every doctor and practice in your funnel — booked from the site, added here, or imported
            from CSV. Click a row for the full profile and timeline.
          </p>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setImportOpen((v) => !v);
            if (importOpen) resetImporter();
          }}
        >
          {importOpen ? 'Close importer' : 'Import CSV'}
        </button>
      </div>

      {importOpen && (
        <section className="panel">
          <div className="panel-head">
            <h2>Import contacts from CSV</h2>
            {(parsed || report) && (
              <button type="button" className="btn btn-small" onClick={resetImporter}>
                Start over
              </button>
            )}
          </div>

          {!parsed && !importing && (
            <div className="import-drop">
              <p className="help-text">
                Upload a CSV with a header row, then map columns to contact fields. Duplicates and
                suppressed addresses are skipped automatically. Imported contacts start in the
                &ldquo;New&rdquo; stage.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              />
            </div>
          )}

          {parsed && !importing && (
            <div className="import-mapper">
              <p className="help-text">
                <strong>{parsed.fileName}</strong> — {fmtNumber(parsed.rows.length)} rows. Map each
                column; unmapped columns can be stored as custom fields.
              </p>
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>CSV column</th>
                      <th>First row sample</th>
                      <th>Import as</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.headers.map((header) => (
                      <tr key={header}>
                        <td className="mono">{header}</td>
                        <td className="dim">{parsed.rows[0]?.[header] ?? ''}</td>
                        <td>
                          <select
                            value={mapping[header] ?? 'skip'}
                            onChange={(e) =>
                              setMapping({ ...mapping, [header]: e.target.value as ColumnTarget })
                            }
                          >
                            {(Object.keys(FIELD_LABELS) as ColumnTarget[]).map((t) => (
                              <option key={t} value={t}>
                                {FIELD_LABELS[t]}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {emailColumns.length !== 1 && (
                <div className="error-banner" role="alert">
                  {emailColumns.length === 0
                    ? 'Map one column to Email to continue.'
                    : 'Only one column can be mapped to Email.'}
                </div>
              )}
              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={emailColumns.length !== 1}
                  onClick={() => void runImport()}
                >
                  Import {fmtNumber(parsed.rows.length)} rows
                </button>
              </div>
            </div>
          )}

          {importing && (
            <div className="import-progress">
              <div className="progress-track">
                <div
                  className="progress-bar"
                  style={{
                    width: progress.total ? `${(progress.done / progress.total) * 100}%` : '10%',
                  }}
                />
              </div>
              <p className="help-text">
                {progress.total
                  ? `Inserting ${fmtNumber(progress.done)} of ${fmtNumber(progress.total)}…`
                  : 'Checking duplicates and the suppression list…'}
              </p>
            </div>
          )}

          {report && (
            <div className="notice-banner">
              Imported <strong>{fmtNumber(report.imported)}</strong> · skipped{' '}
              {fmtNumber(report.duplicates)} duplicate{report.duplicates === 1 ? '' : 's'},{' '}
              {fmtNumber(report.suppressed)} suppressed, {fmtNumber(report.invalid)} invalid email
              {report.invalid === 1 ? '' : 's'}.
            </div>
          )}
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>Contacts {total > 0 && <span className="count-badge">{fmtNumber(total)}</span>}</h2>
          <form onSubmit={submitSearch} className="inline-form">
            <input
              type="search"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Search name, email, phone…"
            />
            <button type="submit" className="btn btn-small">
              Search
            </button>
          </form>
        </div>

        {tableError && (
          <ErrorBanner message={tableError} onRetry={() => void loadContacts(page, search)} />
        )}

        {contacts === null ? (
          <Skeleton rows={6} />
        ) : contacts.length === 0 && !tableError ? (
          <EmptyState
            title={search ? 'No contacts match your search' : 'No contacts yet'}
            hint={
              search
                ? 'Try a different search term.'
                : 'Contacts are created automatically when someone books a call, or import a CSV.'
            }
          />
        ) : (
          <>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Practice</th>
                    <th>Patient flow</th>
                    <th>Stage</th>
                    <th>Source</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c) => (
                    <tr
                      key={c.id}
                      className="row-click"
                      onClick={() => navigate(`/contacts/${c.id}`)}
                    >
                      <td>{fullName(c.first_name, c.last_name) || '—'}</td>
                      <td className="mono">{c.email}</td>
                      <td>{c.phone ?? '—'}</td>
                      <td>{c.practice_type ?? '—'}</td>
                      <td>{c.patient_flow ?? '—'}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <select
                          className="stage-select"
                          value={c.stage}
                          onChange={(e) => void setStage(c, e.target.value as ContactStage)}
                        >
                          {CONTACT_STAGES.map((s) => (
                            <option key={s.key} value={s.key}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <span className="stage-chip">{c.source}</span>
                      </td>
                      <td className="dim">{fmtDate(c.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
          </>
        )}
      </section>
    </div>
  );
}
