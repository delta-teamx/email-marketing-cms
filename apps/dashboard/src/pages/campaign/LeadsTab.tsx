import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Papa from 'papaparse';
import type { ParseResult } from 'papaparse';
import { isValidEmail, normalizeEmail } from '@implenix/shared';
import { fetchAllPages, supabase } from '../../lib/supabase';
import { useToast } from '../../hooks/toast';
import { EmptyState, ErrorBanner, Pagination, Skeleton, StatusPill } from '../../components/ui';
import { fmtDateTime, fmtNumber, fullName } from '../../lib/format';
import type { CampaignRow, LeadRow } from '../../lib/types';

interface Props {
  campaign: CampaignRow;
}

const PAGE_SIZE = 25;
const BATCH_SIZE = 500;

const LEAD_FIELDS = ['email', 'first_name', 'last_name', 'company', 'title', 'phone'] as const;
type LeadField = (typeof LEAD_FIELDS)[number];
type ColumnTarget = LeadField | 'custom' | 'skip';

const FIELD_LABELS: Record<ColumnTarget, string> = {
  email: 'Email',
  first_name: 'First name',
  last_name: 'Last name',
  company: 'Company',
  title: 'Title',
  phone: 'Phone',
  custom: 'Custom field',
  skip: 'Ignore column',
};

function guessTarget(header: string): ColumnTarget {
  const h = header.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (/^(e?mail|email_address)$/.test(h)) return 'email';
  if (/^(first_name|firstname|first|given_name)$/.test(h)) return 'first_name';
  if (/^(last_name|lastname|last|surname|family_name)$/.test(h)) return 'last_name';
  if (/^(company|company_name|organization|organisation|practice|practice_name)$/.test(h)) return 'company';
  if (/^(title|job_title|role|position)$/.test(h)) return 'title';
  if (/^(phone|phone_number|mobile|tel|telephone)$/.test(h)) return 'phone';
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

export function LeadsTab({ campaign }: Props) {
  const toast = useToast();

  // --- importer ----------------------------------------------------------
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
    try {
      const [existingRows, suppressedRows] = await Promise.all([
        fetchAllPages<{ email: string }>((from, to) =>
          supabase.from('leads').select('email').eq('campaign_id', campaign.id).range(from, to),
        ),
        fetchAllPages<{ email: string }>((from, to) =>
          supabase
            .from('suppression_list')
            .select('email')
            .eq('workspace_id', campaign.workspace_id)
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

        const lead: Record<string, unknown> = {
          campaign_id: campaign.id,
          workspace_id: campaign.workspace_id,
          email,
        };
        const custom: Record<string, string> = {};
        for (const header of parsed.headers) {
          if (header === emailColumn) continue;
          const target = mapping[header] ?? 'skip';
          const value = (row[header] ?? '').trim();
          if (!value || target === 'skip') continue;
          if (target === 'custom') custom[header] = value;
          else lead[target] = value;
        }
        if (Object.keys(custom).length > 0) lead.custom_fields = custom;
        toInsert.push(lead);
      }

      setProgress({ done: 0, total: toInsert.length });
      for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
        const batch = toInsert.slice(i, i + BATCH_SIZE);
        const { error } = await supabase.from('leads').insert(batch);
        if (error) throw new Error(error.message);
        counts.imported += batch.length;
        setProgress({ done: Math.min(i + BATCH_SIZE, toInsert.length), total: toInsert.length });
      }

      setReport(counts);
      setParsed(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      toast('success', `Imported ${fmtNumber(counts.imported)} lead${counts.imported === 1 ? '' : 's'}.`);
      setPage(0);
      await loadLeads(0, search);
    } catch (e) {
      toast('error', e instanceof Error ? `Import failed: ${e.message}` : 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  // --- table -------------------------------------------------------------
  const [leads, setLeads] = useState<LeadRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [tableError, setTableError] = useState<string | null>(null);

  const loadLeads = useCallback(
    async (pageNo: number, query: string) => {
      setTableError(null);
      setLeads(null);
      let req = supabase
        .from('leads')
        .select('*', { count: 'exact' })
        .eq('campaign_id', campaign.id);
      const q = query.trim().replace(/[,%()]/g, '');
      if (q) {
        req = req.or(
          `email.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%,company.ilike.%${q}%`,
        );
      }
      const from = pageNo * PAGE_SIZE;
      const { data, count, error } = await req
        .order('created_at', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error) {
        setTableError(error.message);
        setLeads([]);
        return;
      }
      setLeads((data ?? []) as LeadRow[]);
      setTotal(count ?? 0);
    },
    [campaign.id],
  );

  useEffect(() => {
    void loadLeads(page, search);
  }, [loadLeads, page, search]);

  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    setPage(0);
    setSearch(searchDraft);
  };

  const setLeadStatus = async (lead: LeadRow, status: 'active' | 'paused') => {
    const { error } = await supabase.from('leads').update({ status }).eq('id', lead.id);
    if (error) toast('error', `Could not update lead: ${error.message}`);
    else {
      toast('success', status === 'paused' ? `${lead.email} paused.` : `${lead.email} resumed.`);
      await loadLeads(page, search);
    }
  };

  return (
    <div className="tab-body">
      <section className="panel">
        <div className="panel-head">
          <h2>Import leads from CSV</h2>
          {(parsed || report) && (
            <button type="button" className="btn btn-small" onClick={resetImporter}>
              Start over
            </button>
          )}
        </div>

        {!parsed && (
          <div className="import-drop">
            <p className="help-text">
              Upload a CSV with a header row. You will map columns before anything is imported.
              Duplicates and suppressed addresses are skipped automatically.
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
              column; unmapped columns can be stored as custom fields (usable as{' '}
              <span className="mono">{'{{merge_tags}}'}</span>).
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
                  width: progress.total
                    ? `${(progress.done / progress.total) * 100}%`
                    : '10%',
                }}
              />
            </div>
            <p className="help-text">
              {progress.total
                ? `Inserting ${fmtNumber(progress.done)} of ${fmtNumber(progress.total)}…`
                : 'Checking duplicates and suppression list…'}
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

      <section className="panel">
        <div className="panel-head">
          <h2>Leads {total > 0 && <span className="count-badge">{fmtNumber(total)}</span>}</h2>
          <form onSubmit={submitSearch} className="inline-form">
            <input
              type="search"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Search email, name, company…"
            />
            <button type="submit" className="btn btn-small">
              Search
            </button>
          </form>
        </div>

        {tableError && <ErrorBanner message={tableError} onRetry={() => void loadLeads(page, search)} />}

        {leads === null ? (
          <Skeleton rows={6} />
        ) : leads.length === 0 && !tableError ? (
          <EmptyState
            title={search ? 'No leads match your search' : 'No leads yet'}
            hint={
              search
                ? 'Try a different search term.'
                : 'Import a CSV above to build this campaign’s audience.'
            }
          />
        ) : (
          <>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Name</th>
                    <th>Company</th>
                    <th>Stage</th>
                    <th>Status</th>
                    <th className="num">Step</th>
                    <th>Next send</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => (
                    <tr key={lead.id}>
                      <td className="mono">{lead.email}</td>
                      <td>{fullName(lead.first_name, lead.last_name) || '—'}</td>
                      <td>{lead.company ?? '—'}</td>
                      <td>
                        <span className="stage-chip">{lead.stage_key.replace(/_/g, ' ')}</span>
                      </td>
                      <td>
                        <StatusPill value={lead.status} />
                      </td>
                      <td className="num">{lead.current_step}</td>
                      <td className="dim">{fmtDateTime(lead.next_send_at)}</td>
                      <td className="row-actions">
                        {lead.status === 'active' && (
                          <button
                            type="button"
                            className="btn btn-small"
                            onClick={() => void setLeadStatus(lead, 'paused')}
                          >
                            Pause
                          </button>
                        )}
                        {lead.status === 'paused' && (
                          <button
                            type="button"
                            className="btn btn-small"
                            onClick={() => void setLeadStatus(lead, 'active')}
                          >
                            Resume
                          </button>
                        )}
                      </td>
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
