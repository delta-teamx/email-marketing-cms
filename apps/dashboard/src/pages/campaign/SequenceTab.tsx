import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../hooks/toast';
import { useConfirm } from '../../hooks/confirm';
import { EmptyState, ErrorBanner, Skeleton } from '../../components/ui';
import type { CampaignRow, CopyVariantRow, StepWithVariants } from '../../lib/types';

const MERGE_TAGS = ['first_name', 'last_name', 'company', 'title'] as const;

interface Props {
  campaign: CampaignRow;
}

export function SequenceTab({ campaign }: Props) {
  const toast = useToast();
  const confirm = useConfirm();

  const [steps, setSteps] = useState<StepWithVariants[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: err } = await supabase
      .from('sequence_steps')
      .select('*, copy_variants(*)')
      .eq('campaign_id', campaign.id)
      .order('step_no');
    if (err) {
      setError(err.message);
      setSteps([]);
      return;
    }
    const rows = (data ?? []) as StepWithVariants[];
    for (const step of rows) {
      step.copy_variants.sort((a, b) => a.label.localeCompare(b.label));
    }
    setSteps(rows);
  }, [campaign.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const addStep = async () => {
    setBusy(true);
    const nextNo = steps && steps.length > 0 ? Math.max(...steps.map((s) => s.step_no)) + 1 : 1;
    const { error: err } = await supabase.from('sequence_steps').insert({
      campaign_id: campaign.id,
      step_no: nextNo,
      delay_days: nextNo === 1 ? 0 : 3,
    });
    setBusy(false);
    if (err) toast('error', `Could not add step: ${err.message}`);
    else {
      toast('success', `Step ${nextNo} added.`);
      await load();
    }
  };

  const updateDelay = async (step: StepWithVariants, delayDays: number) => {
    if (delayDays === step.delay_days || delayDays < 0 || Number.isNaN(delayDays)) return;
    const { error: err } = await supabase
      .from('sequence_steps')
      .update({ delay_days: delayDays })
      .eq('id', step.id);
    if (err) toast('error', `Could not update delay: ${err.message}`);
    else await load();
  };

  const deleteStep = async (step: StepWithVariants) => {
    const ok = await confirm({
      title: `Delete step ${step.step_no}?`,
      message:
        'The step and all of its copy variants will be permanently deleted. Leads currently waiting on this step will skip it.',
      confirmLabel: 'Delete step',
      danger: true,
    });
    if (!ok) return;
    const { error: err } = await supabase.from('sequence_steps').delete().eq('id', step.id);
    if (err) toast('error', `Could not delete step: ${err.message}`);
    else {
      toast('success', `Step ${step.step_no} deleted.`);
      await load();
    }
  };

  const addVariant = async (step: StepWithVariants) => {
    const usedLabels = new Set(step.copy_variants.map((v) => v.label));
    let label = 'A';
    for (let i = 0; i < 26; i++) {
      const candidate = String.fromCharCode(65 + i);
      if (!usedLabels.has(candidate)) {
        label = candidate;
        break;
      }
    }
    const { error: err } = await supabase.from('copy_variants').insert({
      step_id: step.id,
      label,
      subject: '',
      body: '',
    });
    if (err) toast('error', `Could not add variant: ${err.message}`);
    else await load();
  };

  const deleteVariant = async (variant: CopyVariantRow, stepNo: number) => {
    const ok = await confirm({
      title: `Delete variant ${variant.label} of step ${stepNo}?`,
      message: 'This copy variant will be permanently deleted.',
      confirmLabel: 'Delete variant',
      danger: true,
    });
    if (!ok) return;
    const { error: err } = await supabase.from('copy_variants').delete().eq('id', variant.id);
    if (err) toast('error', `Could not delete variant: ${err.message}`);
    else {
      toast('success', 'Variant deleted.');
      await load();
    }
  };

  return (
    <div className="tab-body">
      <div className="tab-toolbar">
        <p className="help-text">
          Human-written copy only — the sending agent rotates enabled variants by weight and fills
          merge tags per lead. Agents never write or alter your copy.
        </p>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void addStep()}>
          Add step
        </button>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {steps === null ? (
        <Skeleton rows={4} />
      ) : steps.length === 0 && !error ? (
        <EmptyState
          title="No sequence steps yet"
          hint="Add step 1 (the initial email), then follow-ups with a delay in days."
          action={
            <button type="button" className="btn btn-primary" onClick={() => void addStep()}>
              Add step 1
            </button>
          }
        />
      ) : (
        steps.map((step) => (
          <section key={step.id} className="panel step-panel">
            <div className="panel-head">
              <h2>
                Step {step.step_no}
                {step.step_no === 1 && <span className="step-tag">initial email</span>}
              </h2>
              <div className="step-head-controls">
                {step.step_no > 1 && (
                  <label className="delay-field">
                    wait
                    <input
                      type="number"
                      min={0}
                      defaultValue={step.delay_days}
                      key={`${step.id}-${step.delay_days}`}
                      onBlur={(e) => void updateDelay(step, Number(e.target.value))}
                    />
                    days after previous step
                  </label>
                )}
                <button type="button" className="btn btn-small" onClick={() => void addVariant(step)}>
                  Add variant
                </button>
                <button
                  type="button"
                  className="btn btn-small btn-danger-ghost"
                  onClick={() => void deleteStep(step)}
                >
                  Delete step
                </button>
              </div>
            </div>

            {step.copy_variants.length === 0 ? (
              <EmptyState
                title="No copy variants"
                hint="Add at least one variant with a subject and body — steps without enabled copy are skipped."
                action={
                  <button type="button" className="btn" onClick={() => void addVariant(step)}>
                    Add variant
                  </button>
                }
              />
            ) : (
              <div className="variant-list">
                {step.copy_variants.map((variant) => (
                  <VariantEditor
                    key={variant.id}
                    variant={variant}
                    onSaved={load}
                    onDelete={() => void deleteVariant(variant, step.step_no)}
                  />
                ))}
              </div>
            )}
          </section>
        ))
      )}
    </div>
  );
}

function VariantEditor({
  variant,
  onSaved,
  onDelete,
}: {
  variant: CopyVariantRow;
  onSaved: () => Promise<void> | void;
  onDelete: () => void;
}) {
  const toast = useToast();
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const [label, setLabel] = useState(variant.label);
  const [subject, setSubject] = useState(variant.subject);
  const [body, setBody] = useState(variant.body);
  const [weight, setWeight] = useState(variant.weight);
  const [enabled, setEnabled] = useState(variant.enabled);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLabel(variant.label);
    setSubject(variant.subject);
    setBody(variant.body);
    setWeight(variant.weight);
    setEnabled(variant.enabled);
  }, [variant]);

  const dirty =
    label !== variant.label ||
    subject !== variant.subject ||
    body !== variant.body ||
    weight !== variant.weight ||
    enabled !== variant.enabled;

  const insertTag = (tag: string) => {
    const token = `{{${tag}}}`;
    const el = bodyRef.current;
    if (!el) {
      setBody((b) => b + token);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? start;
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + token.length;
    });
  };

  const save = async () => {
    if (!subject.trim() || !body.trim()) {
      toast('error', 'Subject and body are required before saving a variant.');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('copy_variants')
      .update({
        label: label.trim() || variant.label,
        subject,
        body,
        weight: Math.max(1, weight),
        enabled,
      })
      .eq('id', variant.id);
    setSaving(false);
    if (error) toast('error', `Could not save variant: ${error.message}`);
    else {
      toast('success', `Variant ${label.trim() || variant.label} saved.`);
      await onSaved();
    }
  };

  return (
    <div className={enabled ? 'variant-card' : 'variant-card variant-disabled'}>
      <div className="variant-head">
        <label className="field field-tiny">
          <span className="field-label">Label</span>
          <input value={label} maxLength={12} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="field field-tiny">
          <span className="field-label">Weight</span>
          <input
            type="number"
            min={1}
            value={weight}
            onChange={(e) => setWeight(Number(e.target.value))}
          />
        </label>
        <label className="check-field">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>Enabled</span>
        </label>
        <div className="variant-head-spacer" />
        <button type="button" className="btn btn-small btn-danger-ghost" onClick={onDelete}>
          Delete
        </button>
      </div>
      <label className="field">
        <span className="field-label">Subject</span>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Quick question about {{company}}"
        />
      </label>
      <label className="field">
        <span className="field-label">Body</span>
        <textarea
          ref={bodyRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          placeholder={'Hi {{first_name}},\n\n…'}
        />
      </label>
      <div className="merge-chips">
        <span className="merge-chips-label">Insert merge tag:</span>
        {MERGE_TAGS.map((tag) => (
          <button key={tag} type="button" className="chip" onClick={() => insertTag(tag)}>
            {`{{${tag}}}`}
          </button>
        ))}
      </div>
      {dirty && (
        <div className="form-actions">
          <button type="button" className="btn btn-primary btn-small" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save variant'}
          </button>
        </div>
      )}
    </div>
  );
}
