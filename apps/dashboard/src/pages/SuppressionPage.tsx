import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { isValidEmail, normalizeEmail } from '@implenix/shared';
import { fetchAllPages, supabase } from '../lib/supabase';
import { useWorkspace } from '../context/AuthContext';
import { useToast } from '../hooks/toast';
import { EmptyState, ErrorBanner, Pagination, Skeleton } from '../components/ui';
import { csvCell, downloadBlob, fmtDateTime, fmtNumber } from '../lib/format';
import type { SuppressionRow } from '../lib/types';

const PAGE_SIZE = 50;

const REASON_LABELS: Record<string, string> = {
  unsubscribe: 'Unsubscribed',
  dnc_reply: 'DNC reply',
  hard_bounce: 'Hard bounce',
  complaint: 'Spam complaint',
  manual: 'Added manually',
};

export function SuppressionPage() {
  const workspace = useWorkspace();
  const toast = useToast();

  const [rows, setRows] = useState<SuppressionRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(
    async (pageNo: number) => {
      setError(null);
      setRows(null);
      const from = pageNo * PAGE_SIZE;
      const { data, count, error: err } = await supabase
        .from('suppression_list')
        .select('*', { count: 'exact' })
        .eq('workspace_id', workspace.id)
        .order('created_at', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (err) {
        setError(err.message);
        setRows([]);
        return;
      }
      setRows((data ?? []) as SuppressionRow[]);
      setTotal(count ?? 0);
    },
    [workspace.id],
  );

  useEffect(() => {
    void load(page);
  }, [load, page]);

  const addEmail = async (e: FormEvent) => {
    e.preventDefault();
    if (!isValidEmail(newEmail)) {
      toast('error', 'Enter a valid email address.');
      return;
    }
    setAdding(true);
    const { error: err } = await supabase.from('suppression_list').insert({
      workspace_id: workspace.id,
      email: normalizeEmail(newEmail),
      reason: 'manual',
    });
    setAdding(false);
    if (err) {
      if (err.code === '23505') toast('info', 'That address is already suppressed.');
      else toast('error', `Could not add address: ${err.message}`);
      return;
    }
    toast('success', `${normalizeEmail(newEmail)} added to the suppression list.`);
    setNewEmail('');
    setPage(0);
    await load(0);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all = await fetchAllPages<SuppressionRow>((from, to) =>
        supabase
          .from('suppression_list')
          .select('*')
          .eq('workspace_id', workspace.id)
          .order('created_at', { ascending: false })
          .range(from, to),
      );
      const lines = [
        'email,reason,created_at',
        ...all.map((r) => [csvCell(r.email), csvCell(r.reason), csvCell(r.created_at)].join(',')),
      ];
      downloadBlob(`suppression-list-${new Date().toISOString().slice(0, 10)}.csv`, lines.join('\r\n'));
      toast('success', `Exported ${fmtNumber(all.length)} addresses.`);
    } catch (e) {
      toast('error', e instanceof Error ? `Export failed: ${e.message}` : 'Export failed.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Suppression List</h1>
          <p className="page-sub">
            Addresses here never receive follow-up emails — unsubscribes, do-not-contact replies,
            hard bounces and complaints land here automatically and permanently.
          </p>
        </div>
        <button
          type="button"
          className="btn"
          disabled={exporting || total === 0}
          onClick={() => void exportCsv()}
        >
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Add an address</h2>
        </div>
        <form onSubmit={addEmail} className="inline-form">
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="person@example.com"
            required
          />
          <button type="submit" className="btn btn-primary" disabled={adding}>
            {adding ? 'Adding…' : 'Suppress'}
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>
            Suppressed addresses{' '}
            {total > 0 && <span className="count-badge">{fmtNumber(total)}</span>}
          </h2>
        </div>

        {error && <ErrorBanner message={error} onRetry={() => void load(page)} />}

        {rows === null ? (
          <Skeleton rows={5} />
        ) : rows.length === 0 && !error ? (
          <EmptyState
            title="No suppressed addresses"
            hint="Unsubscribes and bounces will appear here automatically as follow-up emails send."
          />
        ) : (
          <>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Reason</th>
                    <th>Added</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{r.email}</td>
                      <td>
                        <span className="stage-chip">{REASON_LABELS[r.reason] ?? r.reason}</span>
                      </td>
                      <td className="dim">{fmtDateTime(r.created_at)}</td>
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
