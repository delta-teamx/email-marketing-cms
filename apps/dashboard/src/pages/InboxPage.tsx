import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { api, ApiError } from '../lib/api';
import { useWorkspace } from '../context/AuthContext';
import { useToast } from '../hooks/toast';
import { useConfirm } from '../hooks/confirm';
import { EmptyState, ErrorBanner, Skeleton } from '../components/ui';
import { fmtDateTime } from '../lib/format';
import type { InboxItem } from '../lib/types';

export function InboxPage() {
  const workspace = useWorkspace();
  const toast = useToast();
  const confirm = useConfirm();

  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: err } = await supabase
      .from('agent_actions')
      .select(
        `*,
         leads ( email, first_name, last_name, company ),
         campaigns ( id, name ),
         inbound_message:messages!agent_actions_inbound_message_id_fkey ( subject, body_text, from_email, created_at )`,
      )
      .eq('workspace_id', workspace.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (err) {
      setError(err.message);
      setItems([]);
      return;
    }
    const rows = (data ?? []) as unknown as InboxItem[];
    setItems(rows);
    setDrafts((prev) => {
      const next: Record<string, string> = {};
      for (const row of rows) next[row.id] = prev[row.id] ?? row.draft_body ?? '';
      return next;
    });
  }, [workspace.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const approve = async (item: InboxItem) => {
    const body = drafts[item.id] ?? '';
    if (!body.trim()) {
      toast('error', 'The reply body is empty — write or restore the draft before sending.');
      return;
    }
    setBusyId(item.id);
    try {
      await api.approveAgentAction(item.id, body);
      toast('success', `Reply to ${item.leads?.email ?? 'lead'} approved and sent.`);
      setItems((current) => (current ?? []).filter((i) => i.id !== item.id));
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Approve failed.');
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (item: InboxItem) => {
    const ok = await confirm({
      title: 'Reject this draft?',
      message: `No reply will be sent to ${item.leads?.email ?? 'this lead'}. The action is logged as rejected.`,
      confirmLabel: 'Reject',
      danger: true,
    });
    if (!ok) return;
    setBusyId(item.id);
    try {
      await api.rejectAgentAction(item.id);
      toast('success', 'Draft rejected.');
      setItems((current) => (current ?? []).filter((i) => i.id !== item.id));
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Reject failed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Approval Inbox</h1>
          <p className="page-sub">
            Drafts waiting for your sign-off — review-first campaigns and low-confidence
            classifications land here. Agents only ever send your templates.
          </p>
        </div>
        <button type="button" className="btn" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {items === null ? (
        <Skeleton rows={4} />
      ) : items.length === 0 && !error ? (
        <EmptyState
          title="All clear"
          hint="Nothing is waiting for approval. New drafts appear here as replies come in."
        />
      ) : (
        <div className="inbox-list">
          {items.map((item) => (
            <section key={item.id} className="panel inbox-item">
              <div className="inbox-item-head">
                <div>
                  <span className="inbox-lead mono">{item.leads?.email ?? 'unknown lead'}</span>
                  {item.campaigns && (
                    <Link to={`/campaigns/${item.campaigns.id}`} className="inbox-campaign">
                      {item.campaigns.name}
                    </Link>
                  )}
                </div>
                <div className="inbox-meta">
                  <span className="stage-chip">
                    {item.classification.replace(/_/g, ' ')} ·{' '}
                    {Math.round(item.confidence * 100)}%
                  </span>
                  <span className="activity-time">{fmtDateTime(item.created_at)}</span>
                </div>
              </div>

              <div className="inbox-message">
                <div className="inbox-message-label">
                  Their reply
                  {item.inbound_message?.created_at
                    ? ` · ${fmtDateTime(item.inbound_message.created_at)}`
                    : ''}
                </div>
                {item.inbound_message ? (
                  <>
                    {item.inbound_message.subject && (
                      <div className="inbox-message-subject">{item.inbound_message.subject}</div>
                    )}
                    <p className="inbox-message-body">
                      {item.inbound_message.body_text || '(no text content)'}
                    </p>
                  </>
                ) : (
                  <p className="inbox-message-body dim">(original message unavailable)</p>
                )}
              </div>

              <label className="field">
                <span className="field-label">
                  Draft reply
                  {item.template_category
                    ? ` — from your ${item.template_category.replace(/_/g, ' ')} template`
                    : ''}
                </span>
                <textarea
                  rows={6}
                  value={drafts[item.id] ?? ''}
                  onChange={(e) => setDrafts({ ...drafts, [item.id]: e.target.value })}
                />
              </label>

              <div className="inbox-actions">
                <button
                  type="button"
                  className="btn btn-danger-ghost"
                  disabled={busyId === item.id}
                  onClick={() => void reject(item)}
                >
                  Reject
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busyId === item.id}
                  onClick={() => void approve(item)}
                >
                  {busyId === item.id ? 'Working…' : 'Approve & Send'}
                </button>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
