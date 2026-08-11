import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { EmptyState, ErrorBanner, Skeleton, StatusPill } from '../../components/ui';
import { fmtDateTime } from '../../lib/format';
import type { AgentActionRow, CampaignRow, MessageRow } from '../../lib/types';

interface Props {
  campaign: CampaignRow;
}

const PAGE_SIZE = 20;

type MessageItem = Pick<
  MessageRow,
  'id' | 'direction' | 'subject' | 'from_email' | 'to_email' | 'status' | 'created_at' | 'sent_at'
>;

type ActionItem = Pick<
  AgentActionRow,
  'id' | 'classification' | 'confidence' | 'action' | 'template_category' | 'status' | 'created_at'
>;

function DirectionIcon({ direction }: { direction: 'outbound' | 'inbound' }) {
  return (
    <svg
      className={`dir-icon dir-${direction}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label={direction}
    >
      {direction === 'outbound' ? (
        <>
          <path d="M5 12h14" />
          <path d="m13 6 6 6-6 6" />
        </>
      ) : (
        <>
          <path d="M19 12H5" />
          <path d="m11 18-6-6 6-6" />
        </>
      )}
    </svg>
  );
}

export function ActivityTab({ campaign }: Props) {
  const [messages, setMessages] = useState<MessageItem[] | null>(null);
  const [messagesDone, setMessagesDone] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [messagesBusy, setMessagesBusy] = useState(false);

  const [actions, setActions] = useState<ActionItem[] | null>(null);
  const [actionsDone, setActionsDone] = useState(false);
  const [actionsError, setActionsError] = useState<string | null>(null);
  const [actionsBusy, setActionsBusy] = useState(false);

  const loadMessages = useCallback(
    async (offset: number) => {
      setMessagesBusy(true);
      setMessagesError(null);
      const { data, error } = await supabase
        .from('messages')
        .select('id, direction, subject, from_email, to_email, status, created_at, sent_at')
        .eq('campaign_id', campaign.id)
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      setMessagesBusy(false);
      if (error) {
        setMessagesError(error.message);
        if (offset === 0) setMessages([]);
        return;
      }
      const rows = (data ?? []) as MessageItem[];
      setMessages((prev) => (offset === 0 ? rows : [...(prev ?? []), ...rows]));
      setMessagesDone(rows.length < PAGE_SIZE);
    },
    [campaign.id],
  );

  const loadActions = useCallback(
    async (offset: number) => {
      setActionsBusy(true);
      setActionsError(null);
      const { data, error } = await supabase
        .from('agent_actions')
        .select('id, classification, confidence, action, template_category, status, created_at')
        .eq('campaign_id', campaign.id)
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      setActionsBusy(false);
      if (error) {
        setActionsError(error.message);
        if (offset === 0) setActions([]);
        return;
      }
      const rows = (data ?? []) as ActionItem[];
      setActions((prev) => (offset === 0 ? rows : [...(prev ?? []), ...rows]));
      setActionsDone(rows.length < PAGE_SIZE);
    },
    [campaign.id],
  );

  useEffect(() => {
    setMessages(null);
    setActions(null);
    void loadMessages(0);
    void loadActions(0);
  }, [loadMessages, loadActions]);

  return (
    <div className="tab-body activity-grid">
      <section className="panel">
        <div className="panel-head">
          <h2>Messages</h2>
        </div>
        {messagesError && (
          <ErrorBanner message={messagesError} onRetry={() => void loadMessages(messages?.length ?? 0)} />
        )}
        {messages === null ? (
          <Skeleton rows={5} />
        ) : messages.length === 0 && !messagesError ? (
          <EmptyState
            title="No messages yet"
            hint="Outbound sends and inbound replies will appear here."
          />
        ) : (
          <>
            <ul className="activity-list">
              {messages.map((m) => (
                <li key={m.id} className="activity-item">
                  <DirectionIcon direction={m.direction} />
                  <div className="activity-main">
                    <span className="activity-subject">{m.subject || '(no subject)'}</span>
                    <span className="activity-meta mono">
                      {m.direction === 'outbound' ? `to ${m.to_email}` : `from ${m.from_email}`}
                    </span>
                  </div>
                  <div className="activity-side">
                    <span className="stage-chip">{m.status}</span>
                    <span className="activity-time">{fmtDateTime(m.sent_at ?? m.created_at)}</span>
                  </div>
                </li>
              ))}
            </ul>
            {!messagesDone && (
              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={messagesBusy}
                  onClick={() => void loadMessages(messages.length)}
                >
                  {messagesBusy ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Agent audit log</h2>
        </div>
        {actionsError && (
          <ErrorBanner message={actionsError} onRetry={() => void loadActions(actions?.length ?? 0)} />
        )}
        {actions === null ? (
          <Skeleton rows={5} />
        ) : actions.length === 0 && !actionsError ? (
          <EmptyState
            title="No agent actions yet"
            hint="Every classification, reply and booking the agent makes is logged here."
          />
        ) : (
          <>
            <ul className="activity-list">
              {actions.map((a) => (
                <li key={a.id} className="activity-item">
                  <div className="activity-main">
                    <span className="activity-subject">
                      {a.classification.replace(/_/g, ' ')}{' '}
                      <em className="confidence">{Math.round(a.confidence * 100)}%</em>
                    </span>
                    <span className="activity-meta">
                      {a.action.replace(/_/g, ' ')}
                      {a.template_category ? ` · ${a.template_category.replace(/_/g, ' ')} template` : ''}
                    </span>
                  </div>
                  <div className="activity-side">
                    <StatusPill value={a.status} />
                    <span className="activity-time">{fmtDateTime(a.created_at)}</span>
                  </div>
                </li>
              ))}
            </ul>
            {!actionsDone && (
              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={actionsBusy}
                  onClick={() => void loadActions(actions.length)}
                >
                  {actionsBusy ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
