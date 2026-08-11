import { useCallback, useEffect, useState, type DragEvent } from 'react';
import { fetchAllPages, supabase } from '../../lib/supabase';
import { useToast } from '../../hooks/toast';
import { EmptyState, ErrorBanner, Skeleton } from '../../components/ui';
import { fullName } from '../../lib/format';
import type { CampaignRow, PipelineStageRow } from '../../lib/types';

interface Props {
  campaign: CampaignRow;
}

type BoardLead = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  stage_key: string;
};

export function PipelineTab({ campaign }: Props) {
  const toast = useToast();

  const [stages, setStages] = useState<PipelineStageRow[] | null>(null);
  const [leads, setLeads] = useState<BoardLead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [{ data: stageData, error: stageErr }, leadData] = await Promise.all([
        supabase
          .from('pipeline_stages')
          .select('*')
          .eq('campaign_id', campaign.id)
          .order('position'),
        fetchAllPages<BoardLead>((from, to) =>
          supabase
            .from('leads')
            .select('id, email, first_name, last_name, company, stage_key')
            .eq('campaign_id', campaign.id)
            .order('created_at', { ascending: false })
            .range(from, to),
        ),
      ]);
      if (stageErr) throw new Error(stageErr.message);
      setStages((stageData ?? []) as PipelineStageRow[]);
      setLeads(leadData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the pipeline.');
      setStages([]);
      setLeads([]);
    }
  }, [campaign.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const onDragStart = (e: DragEvent<HTMLDivElement>, leadId: string) => {
    e.dataTransfer.setData('text/plain', leadId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDrop = async (e: DragEvent<HTMLDivElement>, stageKey: string) => {
    e.preventDefault();
    setDragOverStage(null);
    const leadId = e.dataTransfer.getData('text/plain');
    if (!leadId || !leads) return;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stage_key === stageKey) return;

    const previous = lead.stage_key;
    // Optimistic move, revert on failure.
    setLeads(leads.map((l) => (l.id === leadId ? { ...l, stage_key: stageKey } : l)));
    const { error: err } = await supabase
      .from('leads')
      .update({ stage_key: stageKey })
      .eq('id', leadId);
    if (err) {
      setLeads((current) =>
        (current ?? []).map((l) => (l.id === leadId ? { ...l, stage_key: previous } : l)),
      );
      toast('error', `Could not move lead: ${err.message}`);
    }
  };

  if (error) {
    return (
      <div className="tab-body">
        <ErrorBanner message={error} onRetry={() => void load()} />
      </div>
    );
  }

  if (stages === null || leads === null) {
    return (
      <div className="tab-body">
        <Skeleton rows={5} />
      </div>
    );
  }

  if (leads.length === 0) {
    return (
      <div className="tab-body">
        <EmptyState
          title="The board is empty"
          hint="Import leads in the Leads tab — they start in New and advance automatically as the agent works."
        />
      </div>
    );
  }

  const leadsByStage = new Map<string, BoardLead[]>();
  for (const lead of leads) {
    const bucket = leadsByStage.get(lead.stage_key);
    if (bucket) bucket.push(lead);
    else leadsByStage.set(lead.stage_key, [lead]);
  }

  return (
    <div className="tab-body">
      <p className="help-text">
        Leads move automatically as events and classifications occur — drag a card to override
        manually.
      </p>
      <div className="kanban">
        {stages.map((stage) => {
          const stageLeads = leadsByStage.get(stage.key) ?? [];
          const classes = [
            'kanban-col',
            stage.is_terminal ? 'kanban-terminal' : '',
            dragOverStage === stage.key ? 'kanban-dragover' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div
              key={stage.id}
              className={classes}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setDragOverStage(stage.key);
              }}
              onDragLeave={(e) => {
                if (e.currentTarget === e.target) setDragOverStage(null);
              }}
              onDrop={(e) => void onDrop(e, stage.key)}
            >
              <div className="kanban-col-head">
                <span className="kanban-col-name">{stage.name}</span>
                <span className="kanban-count">{stageLeads.length}</span>
              </div>
              <div className="kanban-cards">
                {stageLeads.map((lead) => (
                  <div
                    key={lead.id}
                    className="kanban-card"
                    draggable
                    onDragStart={(e) => onDragStart(e, lead.id)}
                  >
                    <span className="kanban-card-name">
                      {fullName(lead.first_name, lead.last_name) || lead.email}
                    </span>
                    {fullName(lead.first_name, lead.last_name) !== '' && (
                      <span className="kanban-card-email mono">{lead.email}</span>
                    )}
                    {lead.company && <span className="kanban-card-company">{lead.company}</span>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
