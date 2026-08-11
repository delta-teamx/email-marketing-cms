import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SENDING_DOMAINS } from '@implenix/shared';
import { supabase } from '../lib/supabase';
import { useWorkspace } from '../context/AuthContext';
import { useToast } from '../hooks/toast';
import { Modal } from '../components/Modal';
import { EmptyState, ErrorBanner, Skeleton, StatusPill } from '../components/ui';
import { fmtNumber, fromAddress } from '../lib/format';
import type { CampaignMode, CampaignRow, SendingDomain } from '../lib/types';

interface CampaignCard extends CampaignRow {
  leadCount: number;
  repliedCount: number;
}

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'UTC',
  'Europe/London',
  'Europe/Berlin',
];

interface NewCampaignForm {
  name: string;
  description: string;
  sending_domain: SendingDomain;
  from_name: string;
  from_local_part: string;
  timezone: string;
  mode: CampaignMode;
}

const EMPTY_FORM: NewCampaignForm = {
  name: '',
  description: '',
  sending_domain: 'e.implenix.net',
  from_name: 'Implenix',
  from_local_part: 'hello',
  timezone: 'America/New_York',
  mode: 'review_first',
};

export function CampaignsPage() {
  const workspace = useWorkspace();
  const toast = useToast();
  const navigate = useNavigate();

  const [campaigns, setCampaigns] = useState<CampaignCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState<NewCampaignForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setCampaigns(null);
    const { data, error: err } = await supabase
      .from('campaigns')
      .select('*')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false });
    if (err) {
      setError(err.message);
      setCampaigns([]);
      return;
    }
    const rows = (data ?? []) as CampaignRow[];
    const cards = await Promise.all(
      rows.map(async (c) => {
        const [leads, replied] = await Promise.all([
          supabase
            .from('leads')
            .select('id', { count: 'exact', head: true })
            .eq('campaign_id', c.id),
          supabase
            .from('leads')
            .select('id', { count: 'exact', head: true })
            .eq('campaign_id', c.id)
            .not('last_replied_at', 'is', null),
        ]);
        return {
          ...c,
          leadCount: leads.count ?? 0,
          repliedCount: replied.count ?? 0,
        };
      }),
    );
    setCampaigns(cards);
  }, [workspace.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const createCampaign = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    const { data, error: err } = await supabase
      .from('campaigns')
      .insert({
        workspace_id: workspace.id,
        name: form.name.trim(),
        description: form.description.trim() || null,
        sending_domain: form.sending_domain,
        from_name: form.from_name.trim() || 'Implenix',
        from_local_part: form.from_local_part.trim().toLowerCase() || 'hello',
        timezone: form.timezone,
        mode: form.mode,
      })
      .select('id')
      .single();
    setCreating(false);
    if (err) {
      toast('error', `Could not create campaign: ${err.message}`);
      return;
    }
    toast('success', 'Campaign created.');
    setShowNew(false);
    setForm(EMPTY_FORM);
    navigate(`/campaigns/${(data as { id: string }).id}`);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Campaigns</h1>
          <p className="page-sub">Each campaign has its own audience, copy library and agent.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setShowNew(true)}>
          New campaign
        </button>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {campaigns === null ? (
        <Skeleton rows={4} />
      ) : campaigns.length === 0 && !error ? (
        <EmptyState
          title="No campaigns yet"
          hint="Create your first campaign, paste your copy, import leads and let the agent run."
          action={
            <button type="button" className="btn btn-primary" onClick={() => setShowNew(true)}>
              New campaign
            </button>
          }
        />
      ) : (
        <div className="card-grid">
          {campaigns.map((c) => (
            <Link key={c.id} to={`/campaigns/${c.id}`} className="campaign-card panel">
              <div className="campaign-card-head">
                <h2 className="campaign-name">{c.name}</h2>
                <StatusPill value={c.status} />
              </div>
              {c.description && <p className="campaign-desc">{c.description}</p>}
              <div className="campaign-meta">
                <span className="meta-item">
                  {c.mode === 'full_auto' ? 'Full auto' : 'Review first'}
                </span>
                <span className="meta-item mono">
                  {c.from_name} &lt;{fromAddress(c.from_local_part, c.sending_domain)}&gt;
                </span>
              </div>
              <div className="campaign-stats">
                <div className="quick-stat">
                  <span className="quick-stat-value">{fmtNumber(c.leadCount)}</span>
                  <span className="quick-stat-label">Leads</span>
                </div>
                <div className="quick-stat">
                  <span className="quick-stat-value">{fmtNumber(c.repliedCount)}</span>
                  <span className="quick-stat-label">Replied</span>
                </div>
                <div className="quick-stat">
                  <span className="quick-stat-value">{fmtNumber(c.daily_cap)}</span>
                  <span className="quick-stat-label">Daily cap</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showNew && (
        <Modal title="New campaign" onClose={() => setShowNew(false)}>
          <form onSubmit={createCampaign} className="form-grid">
            <label className="field">
              <span className="field-label">Name</span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Medical billing — US practitioners"
                required
              />
            </label>
            <label className="field">
              <span className="field-label">Description</span>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
                placeholder="Optional summary of the audience and offer"
              />
            </label>
            <div className="field-row">
              <label className="field">
                <span className="field-label">Sending domain</span>
                <select
                  value={form.sending_domain}
                  onChange={(e) =>
                    setForm({ ...form, sending_domain: e.target.value as SendingDomain })
                  }
                >
                  {SENDING_DOMAINS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Timezone</span>
                <select
                  value={form.timezone}
                  onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span className="field-label">From name</span>
                <input
                  value={form.from_name}
                  onChange={(e) => setForm({ ...form, from_name: e.target.value })}
                  required
                />
              </label>
              <label className="field">
                <span className="field-label">From address (local part)</span>
                <div className="input-affix">
                  <input
                    value={form.from_local_part}
                    onChange={(e) => setForm({ ...form, from_local_part: e.target.value })}
                    pattern="[A-Za-z0-9._-]+"
                    title="Letters, numbers, dots, dashes and underscores only"
                    required
                  />
                  <span className="affix">@{form.sending_domain}</span>
                </div>
              </label>
            </div>
            <label className="field">
              <span className="field-label">Mode</span>
              <select
                value={form.mode}
                onChange={(e) => setForm({ ...form, mode: e.target.value as CampaignMode })}
              >
                <option value="review_first">Review first — agent drafts, you approve</option>
                <option value="full_auto">Full auto — agent replies with your templates</option>
              </select>
            </label>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setShowNew(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={creating}>
                {creating ? 'Creating…' : 'Create campaign'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
