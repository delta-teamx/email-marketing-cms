import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  CONTACT_STAGES,
  PATIENT_FLOW_OPTIONS,
  PRACTICE_TYPES,
  isValidEmail,
} from '@implenix/shared';
import { supabase } from '../lib/supabase';
import { useWorkspace } from '../context/AuthContext';
import { useToast } from '../hooks/toast';
import { BookAppointmentModal } from '../components/BookAppointmentModal';
import { SendContractModal } from '../components/SendContractModal';
import { EmptyState, ErrorBanner, Skeleton, StatusPill } from '../components/ui';
import { contactName, fmtDateTime, fullName } from '../lib/format';
import type { AppointmentRow, ContactRow, ContactStage, MessageRow } from '../lib/types';

function DirectionIcon({ direction }: { direction: 'inbound' | 'outbound' }) {
  return (
    <svg
      className={`dir-icon ${direction === 'inbound' ? 'dir-inbound' : 'dir-outbound'}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label={direction}
    >
      {direction === 'inbound' ? (
        <>
          <path d="M19 5 5 19" />
          <path d="M14 19H5v-9" />
        </>
      ) : (
        <>
          <path d="M5 19 19 5" />
          <path d="M10 5h9v9" />
        </>
      )}
    </svg>
  );
}

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const workspace = useWorkspace();
  const toast = useToast();

  const [contact, setContact] = useState<ContactRow | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  const [messages, setMessages] = useState<MessageRow[] | null>(null);
  const [appointments, setAppointments] = useState<AppointmentRow[] | null>(null);
  const [timelineError, setTimelineError] = useState<string | null>(null);

  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    practice_type: '',
    patient_flow: '',
    timezone: '',
    stage: 'new' as ContactStage,
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [booking, setBooking] = useState(false);
  const [sendingContract, setSendingContract] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoadState('loading');
    setLoadError(null);
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', workspace.id)
      .maybeSingle();
    if (error) {
      setLoadError(error.message);
      setLoadState('error');
      return;
    }
    if (!data) {
      setLoadState('missing');
      return;
    }
    const row = data as ContactRow;
    setContact(row);
    setForm({
      first_name: row.first_name ?? '',
      last_name: row.last_name ?? '',
      email: row.email,
      phone: row.phone ?? '',
      practice_type: row.practice_type ?? '',
      patient_flow: row.patient_flow ?? '',
      timezone: row.timezone ?? '',
      stage: row.stage,
      notes: row.notes ?? '',
    });
    setLoadState('ready');
  }, [id, workspace.id]);

  const loadTimeline = useCallback(async () => {
    if (!id) return;
    setTimelineError(null);
    const [msgRes, apptRes] = await Promise.all([
      supabase
        .from('messages')
        .select('*')
        .eq('contact_id', id)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('appointments')
        .select('*')
        .eq('contact_id', id)
        .order('starts_at', { ascending: false }),
    ]);
    if (msgRes.error || apptRes.error) {
      setTimelineError(msgRes.error?.message ?? apptRes.error?.message ?? 'Could not load history.');
      setMessages([]);
      setAppointments([]);
      return;
    }
    setMessages((msgRes.data ?? []) as MessageRow[]);
    setAppointments((apptRes.data ?? []) as AppointmentRow[]);
  }, [id]);

  useEffect(() => {
    void load();
    void loadTimeline();
  }, [load, loadTimeline]);

  const practiceTypeOptions = useMemo(() => {
    const opts: string[] = [...PRACTICE_TYPES];
    if (form.practice_type && !opts.includes(form.practice_type)) opts.unshift(form.practice_type);
    return opts;
  }, [form.practice_type]);

  const patientFlowOptions = useMemo(() => {
    const opts: string[] = [...PATIENT_FLOW_OPTIONS];
    if (form.patient_flow && !opts.includes(form.patient_flow)) opts.unshift(form.patient_flow);
    return opts;
  }, [form.patient_flow]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!contact) return;
    if (!isValidEmail(form.email)) {
      toast('error', 'Enter a valid email address.');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('contacts')
      .update({
        first_name: form.first_name.trim() || null,
        last_name: form.last_name.trim() || null,
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim() || null,
        practice_type: form.practice_type || null,
        patient_flow: form.patient_flow || null,
        timezone: form.timezone.trim() || null,
        stage: form.stage,
        notes: form.notes.trim() || null,
      })
      .eq('id', contact.id);
    setSaving(false);
    if (error) {
      toast('error', `Could not save: ${error.message}`);
    } else {
      toast('success', 'Contact saved.');
      await load();
    }
  };

  if (loadState === 'loading') {
    return (
      <div className="page">
        <Skeleton rows={6} />
      </div>
    );
  }
  if (loadState === 'error') {
    return (
      <div className="page">
        <Link to="/contacts" className="back-link">
          ← All contacts
        </Link>
        <ErrorBanner message={loadError ?? 'Could not load this contact.'} onRetry={() => void load()} />
      </div>
    );
  }
  if (loadState === 'missing' || !contact) {
    return (
      <div className="page">
        <Link to="/contacts" className="back-link">
          ← All contacts
        </Link>
        <EmptyState title="Contact not found" hint="It may have been deleted." />
      </div>
    );
  }

  return (
    <div className="page">
      <Link to="/contacts" className="back-link">
        ← All contacts
      </Link>
      <div className="page-head">
        <div>
          <h1>{contactName(contact)}</h1>
          <p className="page-sub mono">{contact.email}</p>
        </div>
        <div className="head-actions">
          <button type="button" className="btn" onClick={() => setSendingContract(true)}>
            Send contract
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setBooking(true)}>
            Book appointment
          </button>
        </div>
      </div>

      <div className="detail-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Profile</h2>
          </div>
          <form onSubmit={save} className="form-grid">
            <div className="field-row">
              <label className="field">
                <span className="field-label">First name</span>
                <input
                  value={form.first_name}
                  onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="field-label">Last name</span>
                <input
                  value={form.last_name}
                  onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span className="field-label">Email</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                />
              </label>
              <label className="field">
                <span className="field-label">Phone</span>
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span className="field-label">Practice type</span>
                <select
                  value={form.practice_type}
                  onChange={(e) => setForm({ ...form, practice_type: e.target.value })}
                >
                  <option value="">Not set</option>
                  {practiceTypeOptions.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Patient flow</span>
                <select
                  value={form.patient_flow}
                  onChange={(e) => setForm({ ...form, patient_flow: e.target.value })}
                >
                  <option value="">Not set</option>
                  {patientFlowOptions.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span className="field-label">Stage</span>
                <select
                  value={form.stage}
                  onChange={(e) => setForm({ ...form, stage: e.target.value as ContactStage })}
                >
                  {CONTACT_STAGES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Timezone</span>
                <input
                  value={form.timezone}
                  onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                  placeholder="America/New_York"
                />
              </label>
            </div>
            <label className="field">
              <span className="field-label">Notes</span>
              <textarea
                rows={4}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </label>
            <p className="help-text dim">
              Source: {contact.source} · created {fmtDateTime(contact.created_at)}
            </p>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        </section>

        <div className="detail-side">
          <section className="panel">
            <div className="panel-head">
              <h2>Appointments</h2>
            </div>
            {timelineError && <ErrorBanner message={timelineError} onRetry={() => void loadTimeline()} />}
            {appointments === null ? (
              <Skeleton rows={2} />
            ) : appointments.length === 0 ? (
              <p className="help-text">No meetings with this contact yet.</p>
            ) : (
              <ul className="activity-list">
                {appointments.map((a) => (
                  <li key={a.id} className="activity-item">
                    <div className="activity-main">
                      <span className="activity-subject">{fmtDateTime(a.starts_at)}</span>
                      <span className="activity-meta">
                        {a.source}
                        {a.meet_link ? ' · has Meet link' : ''}
                      </span>
                    </div>
                    <div className="activity-side">
                      <StatusPill value={a.outcome} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Emails</h2>
            </div>
            {messages === null ? (
              <Skeleton rows={3} />
            ) : messages.length === 0 ? (
              <p className="help-text">No emails exchanged yet — follow-ups appear here once they send.</p>
            ) : (
              <ul className="activity-list">
                {messages.map((m) => (
                  <li key={m.id} className="activity-item">
                    <DirectionIcon direction={m.direction} />
                    <div className="activity-main">
                      <span className="activity-subject">{m.subject || '(no subject)'}</span>
                      <span className="activity-meta">
                        {m.direction === 'inbound' ? `from ${m.from_email}` : `to ${m.to_email}`} ·{' '}
                        {m.status}
                      </span>
                    </div>
                    <span className="activity-time">{fmtDateTime(m.sent_at ?? m.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {booking && (
        <BookAppointmentModal
          prefill={{
            name: fullName(contact.first_name, contact.last_name) || undefined,
            email: contact.email,
            phone: contact.phone ?? undefined,
            practice_type: contact.practice_type ?? undefined,
            patient_flow: contact.patient_flow ?? undefined,
          }}
          onClose={() => setBooking(false)}
          onBooked={() => {
            void load();
            void loadTimeline();
          }}
        />
      )}
      {sendingContract && (
        <SendContractModal
          contact={contact}
          onClose={() => setSendingContract(false)}
          onSent={() => void loadTimeline()}
        />
      )}
    </div>
  );
}
