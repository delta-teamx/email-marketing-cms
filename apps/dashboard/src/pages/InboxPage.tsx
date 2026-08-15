import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { api, ApiError } from '../lib/api';
import { useWorkspace } from '../context/AuthContext';
import { useToast } from '../hooks/toast';
import { useConfirm } from '../hooks/confirm';
import { EmptyState, ErrorBanner, Skeleton } from '../components/ui';
import { contactName, fmtDateTime } from '../lib/format';
import type { InboxItem } from '../lib/types';

interface Draft {
  subject: string;
  body: string;
}

export function InboxPage() {
  const workspace = useWorkspace();
  const toast = useToast();
  const confirm = useConfirm();

  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: err } = await supabase
      .from('agent_actions')
      .select(
        `*,
         contacts ( id, email, first_name, last_name ),
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
      const next: Record<string, Draft> = {};
      for (const row of rows) {
        next[row.id] = prev[row.id] ?? {
          subject:
            row.draft_subject ??
            (row.inbound_message?.subject ? `Re: ${row.inbound_message.subject}` : ''),
          body: row.draft_body ?? '',
        };
      }
      return next;
    });
  }, [workspace.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const sendReply = async (item: InboxItem) => {
    const draft = drafts[item.id] ?? { subject: '', body: '' };
    if (!draft.body.trim()) {
      toast('error', 'Write a reply before sending.');
      return;
    }
    setBusyId(item.id);
    try {
      await api.replyAgentAction(item.id, {
        subject: draft.subject.trim() || undefined,
        body: draft.body,
      });
      toast('success', `Reply sent to ${item.contacts?.email ?? 'contact'}.`);
      setItems((current) => (current ?? []).filter((i) => i.id !== item.id));
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Could not send the reply.');
    } finally {
      setBusyId(null);
    }
  };

  const dismiss = async (item: InboxItem) => {
    const ok = await confirm({
      title: 'Dismiss without replying?',
      message: `No reply will be sent to ${item.contacts?.email ?? 'this contact'}. The item is removed from the inbox.`,
      confirmLabel: 'Dismiss',
      danger: true,
    });
    if (!ok) return;
    setBusyId(item.id);
    try {
      await api.dismissAgentAction(item.id);
      toast('success', 'Dismissed.');
      setItems((current) => (current ?? []).filter((i) => i.id !== item.id));
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Could not dismiss.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Inbox</h1>
          <p className="page-sub">
            Replies to your follow-up emails, triaged by the agent — reschedule requests and
            questions land here for a human answer.
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
        <EmptyState title="All caught up." hint="New replies appear here as they come in." />
      ) : (
        <div className="inbox-list">
          {items.map((item) => (
            <section key={item.id} className="panel inbox-item">
              <div className="inbox-item-head">
                <div>
                  {item.contacts ? (
                    <Link to={`/contacts/${item.contacts.id}`} className="inbox-lead">
                      {contactName(item.contacts)}
                    </Link>
                  ) : (
                    <span className="inbox-lead">Unknown contact</span>
                  )}
                  <span className="inbox-contact-email mono">
                    {item.contacts?.email ?? item.inbound_message?.from_email ?? ''}
                  </span>
                </div>
                <div className="inbox-meta">
                  <span className="stage-chip">
                    {item.classification.replace(/_/g, ' ')} · {Math.round(item.confidence * 100)}%
                  </span>
                  {item.extracted.meeting_intent === true && (
                    <span className="pill pill-warn">wants to reschedule</span>
                  )}
                  <span className="activity-time">{fmtDateTime(item.created_at)}</span>
                </div>
              </div>

              {typeof item.extracted.summary === 'string' && item.extracted.summary && (
                <p className="inbox-summary">{item.extracted.summary}</p>
              )}

              <details className="inbox-message-details">
                <summary>
                  Their reply
                  {item.inbound_message?.subject ? ` — ${item.inbound_message.subject}` : ''}
                  {item.inbound_message?.created_at
                    ? ` · ${fmtDateTime(item.inbound_message.created_at)}`
                    : ''}
                </summary>
                <div className="inbox-message">
                  {item.inbound_message ? (
                    <p className="inbox-message-body">
                      {item.inbound_message.body_text || '(no text content)'}
                    </p>
                  ) : (
                    <p className="inbox-message-body dim">(original message unavailable)</p>
                  )}
                </div>
              </details>

              <label className="field">
                <span className="field-label">Subject</span>
                <input
                  value={drafts[item.id]?.subject ?? ''}
                  onChange={(e) =>
                    setDrafts({
                      ...drafts,
                      [item.id]: { ...(drafts[item.id] ?? { subject: '', body: '' }), subject: e.target.value },
                    })
                  }
                />
              </label>
              <label className="field">
                <span className="field-label">Your reply</span>
                <textarea
                  rows={6}
                  value={drafts[item.id]?.body ?? ''}
                  onChange={(e) =>
                    setDrafts({
                      ...drafts,
                      [item.id]: { ...(drafts[item.id] ?? { subject: '', body: '' }), body: e.target.value },
                    })
                  }
                />
              </label>

              <div className="inbox-actions">
                <button
                  type="button"
                  className="btn btn-danger-ghost"
                  disabled={busyId === item.id}
                  onClick={() => void dismiss(item)}
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busyId === item.id}
                  onClick={() => void sendReply(item)}
                >
                  {busyId === item.id ? 'Working…' : 'Send reply'}
                </button>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
