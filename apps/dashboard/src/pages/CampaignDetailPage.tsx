import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ErrorBanner, Skeleton, StatusPill } from '../components/ui';
import { fromAddress } from '../lib/format';
import type { CampaignRow } from '../lib/types';
import { OverviewTab } from './campaign/OverviewTab';
import { SequenceTab } from './campaign/SequenceTab';
import { TemplatesTab } from './campaign/TemplatesTab';
import { LeadsTab } from './campaign/LeadsTab';
import { PipelineTab } from './campaign/PipelineTab';
import { ActivityTab } from './campaign/ActivityTab';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'sequence', label: 'Sequence' },
  { key: 'templates', label: 'Reply templates' },
  { key: 'leads', label: 'Leads' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'activity', label: 'Activity' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export function CampaignDetailPage() {
  const { id, tab } = useParams<{ id: string; tab?: string }>();
  const navigate = useNavigate();
  const activeTab: TabKey = TABS.some((t) => t.key === tab) ? (tab as TabKey) : 'overview';

  const [campaign, setCampaign] = useState<CampaignRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    const { data, error: err } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (err) setError(err.message);
    else if (!data) setError('Campaign not found (or you do not have access to it).');
    else setCampaign(data as CampaignRow);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    setLoading(true);
    setCampaign(null);
    void load();
  }, [load]);

  if (!id) return null;

  if (loading) {
    return (
      <div className="page">
        <Skeleton rows={5} />
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div className="page">
        <Link to="/" className="back-link">
          ← Campaigns
        </Link>
        <ErrorBanner message={error ?? 'Campaign not found.'} onRetry={() => void load()} />
      </div>
    );
  }

  return (
    <div className="page">
      <Link to="/" className="back-link">
        ← Campaigns
      </Link>
      <div className="page-head">
        <div>
          <h1 className="with-pill">
            {campaign.name} <StatusPill value={campaign.status} />
          </h1>
          <p className="page-sub mono">
            {campaign.from_name} &lt;{fromAddress(campaign.from_local_part, campaign.sending_domain)}
            &gt; · {campaign.mode === 'full_auto' ? 'Full auto' : 'Review first'} ·{' '}
            {campaign.timezone}
          </p>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={activeTab === t.key}
            className={activeTab === t.key ? 'tab active' : 'tab'}
            onClick={() => navigate(`/campaigns/${id}/${t.key}`)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && <OverviewTab campaign={campaign} onChanged={load} />}
      {activeTab === 'sequence' && <SequenceTab campaign={campaign} />}
      {activeTab === 'templates' && <TemplatesTab campaign={campaign} />}
      {activeTab === 'leads' && <LeadsTab campaign={campaign} />}
      {activeTab === 'pipeline' && <PipelineTab campaign={campaign} />}
      {activeTab === 'activity' && <ActivityTab campaign={campaign} />}
    </div>
  );
}
