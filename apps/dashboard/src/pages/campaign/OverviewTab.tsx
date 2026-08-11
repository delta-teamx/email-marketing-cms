import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { isValidEmail } from '@implenix/shared';
import { supabase } from '../../lib/supabase';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../hooks/toast';
import { EmptyState, ErrorBanner, Skeleton } from '../../components/ui';
import { dayLabel, fmtDate, fmtNumber, hourLabel, rate } from '../../lib/format';
import type { CampaignMode, CampaignRow, CampaignStats } from '../../lib/types';

interface Props {
  campaign: CampaignRow;
  onChanged: () => Promise<void> | void;
}

const FUNNEL_ROWS: { key: keyof CampaignStats['funnel']; label: string }[] = [
  { key: 'contacted', label: 'Sent' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'opened', label: 'Opened' },
  { key: 'clicked', label: 'Clicked' },
  { key: 'replied', label: 'Replied' },
  { key: 'interested', label: 'Interested' },
  { key: 'meetings', label: 'Meetings booked' },
  { key: 'closed', label: 'Closed' },
];

interface SettingsForm {
  daily_cap: number;
  send_window_start: number;
  send_window_end: number;
  send_days: number[];
  warmup_enabled: boolean;
  warmup_start: number;
  warmup_increment: number;
  confidence_threshold: number;
}

function settingsFromCampaign(c: CampaignRow): SettingsForm {
  return {
    daily_cap: c.daily_cap,
    send_window_start: c.send_window_start,
    send_window_end: c.send_window_end,
    send_days: [...c.send_days],
    warmup_enabled: c.warmup_enabled,
    warmup_start: c.warmup_start,
    warmup_increment: c.warmup_increment,
    confidence_threshold: c.confidence_threshold,
  };
}

export function OverviewTab({ campaign, onChanged }: Props) {
  const toast = useToast();

  // --- stats -------------------------------------------------------------
  const [stats, setStats] = useState<CampaignStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      setStats(await api.getCampaignStats(campaign.id));
    } catch (e) {
      setStatsError(e instanceof ApiError ? e.message : 'Could not load stats.');
    } finally {
      setStatsLoading(false);
    }
  }, [campaign.id]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  // --- status / mode -----------------------------------------------------
  const [statusBusy, setStatusBusy] = useState(false);

  const setStatus = async (status: 'active' | 'paused') => {
    setStatusBusy(true);
    try {
      await api.setCampaignStatus(campaign.id, status);
      toast('success', status === 'active' ? 'Campaign activated.' : 'Campaign paused.');
      await onChanged();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Could not update status.');
    } finally {
      setStatusBusy(false);
    }
  };

  const setMode = async (mode: CampaignMode) => {
    const { error } = await supabase.from('campaigns').update({ mode }).eq('id', campaign.id);
    if (error) toast('error', `Could not change mode: ${error.message}`);
    else {
      toast('success', mode === 'full_auto' ? 'Agent set to full auto.' : 'Agent set to review first.');
      await onChanged();
    }
  };

  // --- settings ----------------------------------------------------------
  const [settings, setSettings] = useState<SettingsForm>(() => settingsFromCampaign(campaign));
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    setSettings(settingsFromCampaign(campaign));
  }, [campaign]);

  const toggleDay = (day: number) => {
    setSettings((s) => ({
      ...s,
      send_days: s.send_days.includes(day)
        ? s.send_days.filter((d) => d !== day)
        : [...s.send_days, day].sort((a, b) => a - b),
    }));
  };

  const saveSettings = async (e: FormEvent) => {
    e.preventDefault();
    if (settings.send_days.length === 0) {
      toast('error', 'Pick at least one sending day.');
      return;
    }
    if (settings.send_window_end <= settings.send_window_start) {
      toast('error', 'Send window must end after it starts.');
      return;
    }
    setSavingSettings(true);
    const { error } = await supabase
      .from('campaigns')
      .update({
        daily_cap: settings.daily_cap,
        send_window_start: settings.send_window_start,
        send_window_end: settings.send_window_end,
        send_days: settings.send_days,
        warmup_enabled: settings.warmup_enabled,
        warmup_start: settings.warmup_start,
        warmup_increment: settings.warmup_increment,
        confidence_threshold: settings.confidence_threshold,
      })
      .eq('id', campaign.id);
    setSavingSettings(false);
    if (error) toast('error', `Could not save settings: ${error.message}`);
    else {
      toast('success', 'Settings saved.');
      await onChanged();
    }
  };

  // --- test send ---------------------------------------------------------
  const [testTo, setTestTo] = useState('');
  const [testBusy, setTestBusy] = useState(false);

  const sendTest = async (e: FormEvent) => {
    e.preventDefault();
    if (!isValidEmail(testTo)) {
      toast('error', 'Enter a valid email address for the test send.');
      return;
    }
    setTestBusy(true);
    try {
      await api.sendTestEmail(campaign.id, testTo.trim());
      toast('success', `Test email sent to ${testTo.trim()}.`);
      setTestTo('');
    } catch (err) {
      toast('error', err instanceof ApiError ? err.message : 'Test send failed.');
    } finally {
      setTestBusy(false);
    }
  };

  const funnel = stats?.funnel;
  const funnelMax = funnel ? Math.max(funnel.contacted, 1) : 1;

  return (
    <div className="tab-body overview-grid">
      <section className="panel span-2">
        <div className="panel-head">
          <h2>Funnel</h2>
          <button type="button" className="btn btn-small" onClick={() => void loadStats()}>
            Refresh
          </button>
        </div>
        {statsLoading ? (
          <Skeleton rows={6} />
        ) : statsError ? (
          <ErrorBanner message={statsError} onRetry={() => void loadStats()} />
        ) : funnel && funnel.contacted > 0 ? (
          <>
            <div className="stat-tiles">
              <div className="stat-tile">
                <span className="stat-value">{fmtNumber(funnel.leads)}</span>
                <span className="stat-label">Leads</span>
              </div>
              <div className="stat-tile">
                <span className="stat-value">{fmtNumber(funnel.contacted)}</span>
                <span className="stat-label">Sent</span>
              </div>
              <div className="stat-tile">
                <span className="stat-value">{rate(funnel.opened, funnel.contacted)}</span>
                <span className="stat-label">Open rate</span>
              </div>
              <div className="stat-tile">
                <span className="stat-value">{rate(funnel.replied, funnel.contacted)}</span>
                <span className="stat-label">Reply rate</span>
              </div>
            </div>
            <div className="funnel">
              {FUNNEL_ROWS.map(({ key, label }) => {
                const value = funnel[key];
                return (
                  <div key={key} className="funnel-row">
                    <span className="funnel-label">{label}</span>
                    <div className="funnel-track">
                      <div
                        className="funnel-bar"
                        style={{ width: `${Math.max((value / funnelMax) * 100, value > 0 ? 1.5 : 0)}%` }}
                      />
                    </div>
                    <span className="funnel-value">
                      {fmtNumber(value)}
                      <em>{key === 'contacted' ? '' : ` · ${rate(value, funnel.contacted)}`}</em>
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <EmptyState
            title="No sends yet"
            hint="Stats appear here once the campaign is active and the first emails go out."
          />
        )}
      </section>

      {stats && stats.byStep.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>Per step</h2>
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Step</th>
                  <th className="num">Sent</th>
                  <th className="num">Opened</th>
                  <th className="num">Replied</th>
                  <th className="num">Open rate</th>
                  <th className="num">Reply rate</th>
                </tr>
              </thead>
              <tbody>
                {stats.byStep.map((s) => (
                  <tr key={s.step_no}>
                    <td>Step {s.step_no}</td>
                    <td className="num">{fmtNumber(s.sent)}</td>
                    <td className="num">{fmtNumber(s.opened)}</td>
                    <td className="num">{fmtNumber(s.replied)}</td>
                    <td className="num">{rate(s.opened, s.sent)}</td>
                    <td className="num">{rate(s.replied, s.sent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {stats && stats.byVariant.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>A/B variants</h2>
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Variant</th>
                  <th className="num">Sent</th>
                  <th className="num">Open rate</th>
                  <th className="num">Reply rate</th>
                </tr>
              </thead>
              <tbody>
                {stats.byVariant.map((v) => (
                  <tr key={v.variant_id}>
                    <td>
                      Step {v.step_no} · <strong>{v.label}</strong>
                    </td>
                    <td className="num">{fmtNumber(v.sent)}</td>
                    <td className="num">{rate(v.opened, v.sent)}</td>
                    <td className="num">{rate(v.replied, v.sent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>Status &amp; agent mode</h2>
        </div>
        <div className="status-controls">
          {campaign.status === 'active' ? (
            <button
              type="button"
              className="btn"
              disabled={statusBusy}
              onClick={() => void setStatus('paused')}
            >
              {statusBusy ? 'Working…' : 'Pause campaign'}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={statusBusy || campaign.status === 'archived'}
              onClick={() => void setStatus('active')}
            >
              {statusBusy ? 'Working…' : 'Activate campaign'}
            </button>
          )}
          <p className="help-text">
            Activation starts the warm-up ramp
            {campaign.warmup_started_at
              ? ` (started ${fmtDate(campaign.warmup_started_at)})`
              : ' on the first activation'}
            . Sending respects the daily cap, send window and weekday schedule below.
          </p>
        </div>
        <div className="mode-toggle" role="radiogroup" aria-label="Agent mode">
          <button
            type="button"
            role="radio"
            aria-checked={campaign.mode === 'review_first'}
            className={campaign.mode === 'review_first' ? 'mode-option active' : 'mode-option'}
            onClick={() => campaign.mode !== 'review_first' && void setMode('review_first')}
          >
            <strong>Review first</strong>
            <span>Agent drafts replies from your templates; you approve each one.</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={campaign.mode === 'full_auto'}
            className={campaign.mode === 'full_auto' ? 'mode-option active' : 'mode-option'}
            onClick={() => campaign.mode !== 'full_auto' && void setMode('full_auto')}
          >
            <strong>Full auto</strong>
            <span>Agent sends your templates automatically; low-confidence replies still queue for review.</span>
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Sending settings</h2>
        </div>
        <form onSubmit={saveSettings} className="form-grid">
          <div className="field-row">
            <label className="field">
              <span className="field-label">Daily cap</span>
              <input
                type="number"
                min={1}
                value={settings.daily_cap}
                onChange={(e) => setSettings({ ...settings, daily_cap: Number(e.target.value) })}
                required
              />
            </label>
            <label className="field">
              <span className="field-label">Confidence threshold</span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={settings.confidence_threshold}
                onChange={(e) =>
                  setSettings({ ...settings, confidence_threshold: Number(e.target.value) })
                }
                required
              />
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              <span className="field-label">Send window start</span>
              <select
                value={settings.send_window_start}
                onChange={(e) =>
                  setSettings({ ...settings, send_window_start: Number(e.target.value) })
                }
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Send window end</span>
              <select
                value={settings.send_window_end}
                onChange={(e) =>
                  setSettings({ ...settings, send_window_end: Number(e.target.value) })
                }
              >
                {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="field">
            <span className="field-label">Send days</span>
            <div className="day-picker">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <button
                  key={d}
                  type="button"
                  className={settings.send_days.includes(d) ? 'day-chip active' : 'day-chip'}
                  aria-pressed={settings.send_days.includes(d)}
                  onClick={() => toggleDay(d)}
                >
                  {dayLabel(d)}
                </button>
              ))}
            </div>
          </div>
          <div className="field-row warmup-row">
            <label className="check-field">
              <input
                type="checkbox"
                checked={settings.warmup_enabled}
                onChange={(e) => setSettings({ ...settings, warmup_enabled: e.target.checked })}
              />
              <span>Warm-up ramp</span>
            </label>
            <label className="field">
              <span className="field-label">Start at / day</span>
              <input
                type="number"
                min={1}
                value={settings.warmup_start}
                disabled={!settings.warmup_enabled}
                onChange={(e) => setSettings({ ...settings, warmup_start: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              <span className="field-label">Increase / day</span>
              <input
                type="number"
                min={0}
                value={settings.warmup_increment}
                disabled={!settings.warmup_enabled}
                onChange={(e) =>
                  setSettings({ ...settings, warmup_increment: Number(e.target.value) })
                }
              />
            </label>
          </div>
          <p className="help-text">
            Replies classified below the confidence threshold always go to the Approval Inbox,
            even in full-auto mode.
          </p>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={savingSettings}>
              {savingSettings ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Send test email</h2>
        </div>
        <p className="help-text">
          Sends step 1 of this sequence to an address of yours, with merge tags filled from sample
          values, so you can check rendering and deliverability.
        </p>
        <form onSubmit={sendTest} className="inline-form">
          <input
            type="email"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder="you@example.com"
            required
          />
          <button type="submit" className="btn btn-primary" disabled={testBusy}>
            {testBusy ? 'Sending…' : 'Send test'}
          </button>
        </form>
      </section>
    </div>
  );
}
