import { useCallback, useEffect, useMemo, useState } from 'react';
import { FOLLOWUP_TRIGGERS, FOLLOWUP_TRIGGER_LABELS } from '@implenix/shared';
import { api, ApiError } from '../lib/api';
import { ErrorBanner, Skeleton } from '../components/ui';
import { fmtMoney, fmtNumber, rate } from '../lib/format';
import type { StatsResponse } from '../lib/types';

const DAY_OPTIONS = [7, 30, 90] as const;

interface FunnelStage {
  label: string;
  value: number;
}

export function DashboardPage() {
  const [days, setDays] = useState<number>(30);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (d: number) => {
    setStats(null);
    setError(null);
    try {
      setStats(await api.getStats(d));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load stats.');
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  const funnelStages: FunnelStage[] = useMemo(() => {
    if (!stats) return [];
    return [
      { label: 'Visitors', value: stats.site.visitors },
      { label: 'Started booking', value: stats.site.booking_started },
      { label: 'Booked', value: stats.funnel.booked },
      { label: 'Showed', value: stats.funnel.showed },
      { label: 'Negotiating', value: stats.funnel.negotiating },
      { label: 'Closed won', value: stats.funnel.closed_won },
    ];
  }, [stats]);

  const funnelMax = Math.max(1, ...funnelStages.map((s) => s.value));

  const emailRows = useMemo(() => {
    if (!stats) return [];
    return [...stats.email].sort((a, b) => {
      const t = FOLLOWUP_TRIGGERS.indexOf(a.trigger) - FOLLOWUP_TRIGGERS.indexOf(b.trigger);
      return t !== 0 ? t : a.position - b.position;
    });
  }, [stats]);

  const showRate = stats
    ? rate(stats.funnel.showed, stats.funnel.showed + stats.funnel.no_show)
    : '—';
  const outstandingCents = stats
    ? stats.payments.due_cents + stats.payments.overdue_cents
    : 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="page-sub">
            Site traffic, the booking funnel, follow-up email performance, and money — at a glance.
          </p>
        </div>
        <div className="day-picker" role="group" aria-label="Date range">
          {DAY_OPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              className={days === d ? 'day-chip active' : 'day-chip'}
              onClick={() => setDays(d)}
            >
              {d} days
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load(days)} />}

      {stats === null && !error ? (
        <Skeleton rows={6} />
      ) : stats === null ? null : (
        <>
          <div className="stat-tiles">
            <div className="stat-tile">
              <span className="stat-value">{fmtNumber(stats.site.visitors)}</span>
              <span className="stat-label">Visitors</span>
            </div>
            <div className="stat-tile">
              <span className="stat-value">{fmtNumber(stats.site.pageviews)}</span>
              <span className="stat-label">Pageviews</span>
            </div>
            <div className="stat-tile">
              <span className="stat-value">{fmtNumber(stats.funnel.booked)}</span>
              <span className="stat-label">Bookings</span>
            </div>
            <div className="stat-tile">
              <span className="stat-value">{fmtNumber(stats.funnel.upcoming)}</span>
              <span className="stat-label">Upcoming meetings</span>
            </div>
            <div className="stat-tile">
              <span className="stat-value">{showRate}</span>
              <span className="stat-label">Show rate</span>
            </div>
            <div className="stat-tile">
              <span className="stat-value">{fmtNumber(stats.funnel.closed_won)}</span>
              <span className="stat-label">Closed won</span>
            </div>
            <div className="stat-tile">
              <span className="stat-value">{fmtMoney(outstandingCents)}</span>
              <span className="stat-label">Outstanding</span>
            </div>
            <div className="stat-tile">
              <span className={stats.payments.overdue_cents > 0 ? 'stat-value stat-bad' : 'stat-value'}>
                {fmtMoney(stats.payments.overdue_cents)}
              </span>
              <span className="stat-label">Overdue</span>
            </div>
          </div>

          <section className="panel">
            <div className="panel-head">
              <h2>Funnel — last {stats.days} days</h2>
            </div>
            <div className="funnel">
              {funnelStages.map((stage, i) => (
                <div key={stage.label} className="funnel-row">
                  <span className="funnel-label">{stage.label}</span>
                  <div className="funnel-track">
                    <div
                      className="funnel-bar"
                      style={{ width: `${(stage.value / funnelMax) * 100}%` }}
                    />
                  </div>
                  <span className="funnel-value">
                    {fmtNumber(stage.value)}{' '}
                    {i > 0 && <em>· {rate(stage.value, funnelStages[i - 1].value)}</em>}
                  </span>
                </div>
              ))}
            </div>
            <p className="help-text funnel-note">
              Percentages are conversion from the previous stage. Negotiating and closed-won are
              current stage counts, not period-scoped.
            </p>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Follow-up email performance</h2>
            </div>
            {emailRows.length === 0 ? (
              <p className="help-text">No follow-up sends in this period yet.</p>
            ) : (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Step</th>
                      <th>Subject</th>
                      <th className="num">Sent</th>
                      <th className="num">Opened</th>
                      <th className="num">Open rate</th>
                      <th className="num">Clicked</th>
                      <th className="num">Click rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emailRows.map((row) => (
                      <tr key={row.step_id}>
                        <td>
                          <span className="stage-chip">
                            {FOLLOWUP_TRIGGER_LABELS[row.trigger]}
                            {row.trigger === 'before_meeting' ? ` #${row.position}` : ''}
                          </span>
                        </td>
                        <td>{row.subject}</td>
                        <td className="num">{fmtNumber(row.sent)}</td>
                        <td className="num">{fmtNumber(row.opened)}</td>
                        <td className="num">{rate(row.opened, row.sent)}</td>
                        <td className="num">{fmtNumber(row.clicked)}</td>
                        <td className="num">{rate(row.clicked, row.sent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Contracts</h2>
            </div>
            <div className="chip-row">
              <span className="stage-chip">Sent: {fmtNumber(stats.contracts.sent ?? 0)}</span>
              <span className="stage-chip">Viewed: {fmtNumber(stats.contracts.viewed ?? 0)}</span>
              <span className="stage-chip">Signed: {fmtNumber(stats.contracts.signed ?? 0)}</span>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
