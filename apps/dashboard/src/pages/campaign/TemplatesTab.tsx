import { useCallback, useEffect, useState } from 'react';
import { TEMPLATE_CATEGORIES } from '@implenix/shared';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../hooks/toast';
import { ErrorBanner, Skeleton } from '../../components/ui';
import type { CampaignRow, ReplyTemplateRow, TemplateCategory } from '../../lib/types';

interface Props {
  campaign: CampaignRow;
}

const CATEGORY_INFO: Record<TemplateCategory, { title: string; helper: string }> = {
  interested: {
    title: 'Interested',
    helper:
      'Sent when a reply is classified as interested. If meeting intent is detected the agent also proposes real calendar slots, so this template should invite them to pick a time.',
  },
  neutral: {
    title: 'Neutral / question',
    helper:
      'Sent when a reply asks a question or is non-committal. Answer common questions and keep the conversation moving toward a call.',
  },
  not_interested: {
    title: 'Not interested',
    helper:
      'Sent when a reply politely declines. A short, courteous close-out — the lead is moved to the Not Interested stage and the sequence stops.',
  },
  dnc: {
    title: 'Do not contact',
    helper:
      'Sent when a reply asks to be removed. Confirms removal — the address is added to the suppression list permanently before this goes out.',
  },
};

export function TemplatesTab({ campaign }: Props) {
  const [templates, setTemplates] = useState<Record<string, ReplyTemplateRow> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: err } = await supabase
      .from('reply_templates')
      .select('*')
      .eq('campaign_id', campaign.id);
    if (err) {
      setError(err.message);
      setTemplates({});
      return;
    }
    const byCategory: Record<string, ReplyTemplateRow> = {};
    for (const row of (data ?? []) as ReplyTemplateRow[]) byCategory[row.category] = row;
    setTemplates(byCategory);
  }, [campaign.id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="tab-body">
      <div className="notice-banner">
        Agents only ever send <strong>your</strong> templates — they never write copy. Replies are
        classified, then the matching template below is merge-filled and sent (or queued for your
        approval, depending on mode and confidence).
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {templates === null ? (
        <Skeleton rows={4} />
      ) : (
        <div className="template-grid">
          {TEMPLATE_CATEGORIES.map((category) => (
            <TemplateEditor
              key={category}
              campaignId={campaign.id}
              category={category}
              existing={templates[category] ?? null}
              onSaved={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateEditor({
  campaignId,
  category,
  existing,
  onSaved,
}: {
  campaignId: string;
  category: TemplateCategory;
  existing: ReplyTemplateRow | null;
  onSaved: () => Promise<void> | void;
}) {
  const toast = useToast();
  const info = CATEGORY_INFO[category];
  const [body, setBody] = useState(existing?.body ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setBody(existing?.body ?? '');
  }, [existing]);

  const dirty = body !== (existing?.body ?? '');

  const save = async () => {
    if (!body.trim()) {
      toast('error', 'Template body cannot be empty.');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('reply_templates')
      .upsert(
        { campaign_id: campaignId, category, body },
        { onConflict: 'campaign_id,category' },
      );
    setSaving(false);
    if (error) toast('error', `Could not save template: ${error.message}`);
    else {
      toast('success', `${info.title} template saved.`);
      await onSaved();
    }
  };

  return (
    <section className="panel template-panel">
      <div className="panel-head">
        <h2>{info.title}</h2>
        {!existing && <span className="pill pill-warn">missing</span>}
      </div>
      <p className="help-text">{info.helper}</p>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={7}
        placeholder={`Your ${info.title.toLowerCase()} reply… merge tags like {{first_name}} work here too.`}
      />
      <div className="form-actions">
        <button
          type="button"
          className="btn btn-primary btn-small"
          disabled={saving || !dirty}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : existing ? 'Save changes' : 'Create template'}
        </button>
      </div>
    </section>
  );
}
