import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FOLLOWUP_MERGE_TAGS,
  FOLLOWUP_TRIGGERS,
  FOLLOWUP_TRIGGER_LABELS,
  isValidEmail,
  type FollowupTrigger,
} from '@implenix/shared';
import { supabase } from '../lib/supabase';
import { api, ApiError } from '../lib/api';
import { useWorkspace } from '../context/AuthContext';
import { useToast } from '../hooks/toast';
import { useConfirm } from '../hooks/confirm';
import { EmptyState, ErrorBanner, Skeleton } from '../components/ui';
import type { FollowupStepRow } from '../lib/types';

const STEP_DEFAULTS: Record<FollowupTrigger, { offset_minutes: number; subject: string; body: string }> = {
  confirmation: {
    offset_minutes: 0,
    subject: 'Confirmed: your Implenix intro call — {{meeting_time}}',
    body: 'Hi {{first_name}},\n\nYour call with Implenix is confirmed.\n\nWhen: {{meeting_time}}\nGoogle Meet: {{meet_link}}\n\nTalk soon,\nThe Implenix team',
  },
  before_meeting: {
    offset_minutes: 60,
    subject: 'Coming up: your Implenix call — {{meeting_time}}',
    body: 'Hi {{first_name}},\n\nA quick reminder about your upcoming call with Implenix.\n\nWhen: {{meeting_time}}\nGoogle Meet: {{meet_link}}\n\nSee you soon,\nThe Implenix team',
  },
  after_showed: {
    offset_minutes: 60,
    subject: 'Great speaking with you, {{first_name}}',
    body: 'Hi {{first_name}},\n\nThank you for taking the time today. We will follow up with the next steps for {{practice_type}} billing.\n\nBest,\nThe Implenix team',
  },
  after_no_show: {
    offset_minutes: 30,
    subject: 'Sorry we missed you — shall we rebook?',
    body: 'Hi {{first_name}},\n\nLooks like today did not work out — no problem at all.\n\nGrab a new time here: {{booking_link}}\n\nBest,\nThe Implenix team',
  },
};

export function FollowupsPage() {
  const workspace = useWorkspace();
  const toast = useToast();
  const confirm = useConfirm();

  const [steps, setSteps] = useState<FollowupStepRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingTrigger, setAddingTrigger] = useState<FollowupTrigger | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: err } = await supabase
      .from('followup_steps')
      .select('*')
      .eq('workspace_id', workspace.id)
      .order('position');
    if (err) {
      setError(err.message);
      setSteps([]);
      return;
    }
    setSteps((data ?? []) as FollowupStepRow[]);
  }, [workspace.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const addStep = async (trigger: FollowupTrigger) => {
    const group = (steps ?? []).filter((s) => s.trigger === trigger);
    const position = group.length > 0 ? Math.max(...group.map((s) => s.position)) + 1 : 1;
    setAddingTrigger(trigger);
    const { error: err } = await supabase.from('followup_steps').insert({
      workspace_id: workspace.id,
      trigger,
      position,
      ...STEP_DEFAULTS[trigger],
    });
    setAddingTrigger(null);
    if (err) {
      toast('error', `Could not add step: ${err.message}`);
    } else {
      toast('success', 'Step added — edit the copy below.');
      await load();
    }
  };

  const deleteStep = async (step: FollowupStepRow) => {
    const ok = await confirm({
      title: 'Delete this step?',
      message: `"${step.subject}" will no longer send for future meetings. Emails already sent are unaffected.`,
      confirmLabel: 'Delete step',
      danger: true,
    });
    if (!ok) return;
    const { error: err } = await supabase.from('followup_steps').delete().eq('id', step.id);
    if (err) toast('error', `Could not delete step: ${err.message}`);
    else {
      toast('success', 'Step deleted.');
      await load();
    }
  };

  const toggleStep = async (step: FollowupStepRow, enabled: boolean) => {
    const { error: err } = await supabase
      .from('followup_steps')
      .update({ enabled })
      .eq('id', step.id);
    if (err) {
      toast('error', `Could not update step: ${err.message}`);
    } else {
      toast('success', enabled ? 'Step enabled.' : 'Step disabled — it will not send.');
      setSteps((rows) => (rows ?? []).map((r) => (r.id === step.id ? { ...r, enabled } : r)));
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Follow-ups</h1>
          <p className="page-sub">
            The automated email sequence around every booked meeting: instant confirmation,
            reminders before, and follow-ups after the outcome.
          </p>
        </div>
      </div>

      <div className="notice-banner followups-banner">
        These emails send <strong>automatically</strong> around each booked meeting. Edits apply to
        all future sends.
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {steps === null ? (
        <Skeleton rows={5} />
      ) : (
        FOLLOWUP_TRIGGERS.map((trigger) => {
          const group = steps
            .filter((s) => s.trigger === trigger)
            .sort((a, b) => a.position - b.position);
          return (
            <section key={trigger} className="followup-group">
              <div className="followup-group-head">
                <h2>{FOLLOWUP_TRIGGER_LABELS[trigger]}</h2>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={addingTrigger !== null}
                  onClick={() => void addStep(trigger)}
                >
                  {addingTrigger === trigger ? 'Adding…' : 'Add step'}
                </button>
              </div>
              {group.length === 0 ? (
                <EmptyState
                  title="No steps here"
                  hint="Add a step to send an email at this point in the funnel."
                />
              ) : (
                group.map((step) => (
                  <StepEditor
                    key={step.id}
                    step={step}
                    onToggle={(enabled) => void toggleStep(step, enabled)}
                    onDelete={() => void deleteStep(step)}
                    onSaved={load}
                  />
                ))
              )}
            </section>
          );
        })
      )}
    </div>
  );
}

function offsetToParts(minutes: number): { value: number; unit: 'minutes' | 'hours' } {
  if (minutes >= 60 && minutes % 60 === 0) return { value: minutes / 60, unit: 'hours' };
  return { value: minutes, unit: 'minutes' };
}

function StepEditor({
  step,
  onToggle,
  onDelete,
  onSaved,
}: {
  step: FollowupStepRow;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const toast = useToast();
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const initial = offsetToParts(step.offset_minutes);
  const [offsetValue, setOffsetValue] = useState(initial.value);
  const [offsetUnit, setOffsetUnit] = useState<'minutes' | 'hours'>(initial.unit);
  const [subject, setSubject] = useState(step.subject);
  const [body, setBody] = useState(step.body);
  const [saving, setSaving] = useState(false);

  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    const parts = offsetToParts(step.offset_minutes);
    setOffsetValue(parts.value);
    setOffsetUnit(parts.unit);
    setSubject(step.subject);
    setBody(step.body);
  }, [step]);

  const offsetMinutes =
    offsetUnit === 'hours' ? Math.round(offsetValue * 60) : Math.round(offsetValue);
  const dirty =
    subject !== step.subject || body !== step.body || offsetMinutes !== step.offset_minutes;

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
      toast('error', 'Subject and body are required.');
      return;
    }
    if (step.trigger !== 'confirmation' && (Number.isNaN(offsetMinutes) || offsetMinutes < 0)) {
      toast('error', 'The timing offset must be zero or more.');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('followup_steps')
      .update({
        subject,
        body,
        offset_minutes: step.trigger === 'confirmation' ? 0 : offsetMinutes,
      })
      .eq('id', step.id);
    setSaving(false);
    if (error) toast('error', `Could not save step: ${error.message}`);
    else {
      toast('success', 'Step saved.');
      await onSaved();
    }
  };

  const sendTest = async () => {
    if (!isValidEmail(testTo)) {
      toast('error', 'Enter a valid address for the test send.');
      return;
    }
    setTesting(true);
    try {
      await api.sendFollowupTest(step.id, testTo.trim());
      toast('success', `Test email sent to ${testTo.trim()}.`);
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Test send failed.');
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className={step.enabled ? 'panel step-panel' : 'panel step-panel step-disabled'}>
      <div className="panel-head">
        <h2>
          <label className="check-field">
            <input
              type="checkbox"
              checked={step.enabled}
              onChange={(e) => onToggle(e.target.checked)}
            />
            <span>{step.enabled ? 'Enabled' : 'Disabled'}</span>
          </label>
        </h2>
        <div className="step-head-controls">
          {step.trigger === 'confirmation' ? (
            <span className="step-tag">sends immediately on booking</span>
          ) : (
            <label className="delay-field">
              <input
                type="number"
                min={0}
                step={offsetUnit === 'hours' ? 0.5 : 1}
                value={offsetValue}
                onChange={(e) => setOffsetValue(Number(e.target.value))}
              />
              <select
                className="delay-unit"
                value={offsetUnit}
                onChange={(e) => setOffsetUnit(e.target.value as 'minutes' | 'hours')}
              >
                <option value="minutes">minutes</option>
                <option value="hours">hours</option>
              </select>
              {step.trigger === 'before_meeting'
                ? 'before the meeting'
                : step.trigger === 'after_showed'
                  ? 'after marking showed'
                  : 'after marking no-show'}
            </label>
          )}
          <button type="button" className="btn btn-small btn-danger-ghost" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>

      <div className="form-grid">
        <label className="field">
          <span className="field-label">Subject</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Body</span>
          <textarea
            ref={bodyRef}
            rows={8}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <div className="merge-chips">
          <span className="merge-chips-label">Insert merge tag:</span>
          {FOLLOWUP_MERGE_TAGS.map((tag) => (
            <button key={tag} type="button" className="chip" onClick={() => insertTag(tag)}>
              {`{{${tag}}}`}
            </button>
          ))}
        </div>
        <div className="step-foot">
          <div className="inline-form">
            <input
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="you@implenix.net"
            />
            <button
              type="button"
              className="btn btn-small"
              disabled={testing}
              onClick={() => void sendTest()}
            >
              {testing ? 'Sending…' : 'Send test'}
            </button>
          </div>
          {dirty && (
            <button
              type="button"
              className="btn btn-primary btn-small"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save step'}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
