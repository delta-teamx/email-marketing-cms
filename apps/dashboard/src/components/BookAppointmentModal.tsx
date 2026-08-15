import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { BookingSlot } from '@implenix/shared';
import { PATIENT_FLOW_OPTIONS, PRACTICE_TYPES, isValidEmail } from '@implenix/shared';
import { api, ApiError, fetchBookingSlots } from '../lib/api';
import { useToast } from '../hooks/toast';
import { Modal } from './Modal';
import { Spinner } from './ui';
import { fmtTime } from '../lib/format';

export interface BookingPrefill {
  name?: string;
  email?: string;
  phone?: string;
  practice_type?: string;
  patient_flow?: string;
}

/** Local YYYY-MM-DD for a date offset from today. */
function isoDay(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayLabel(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  if (offsetDays === 0) return `Today · ${label}`;
  if (offsetDays === 1) return `Tomorrow · ${label}`;
  return label;
}

/**
 * Book an appointment on the shared calendar: pick a day (next 14),
 * pick a free slot, fill in the intake form. Used from the Appointments
 * page and (pre-filled) from a contact's detail page.
 */
export function BookAppointmentModal({
  prefill,
  onClose,
  onBooked,
}: {
  prefill?: BookingPrefill;
  onClose: () => void;
  onBooked: () => void;
}) {
  const toast = useToast();
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  const [date, setDate] = useState(isoDay(0));
  const [slots, setSlots] = useState<BookingSlot[] | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [slot, setSlot] = useState<BookingSlot | null>(null);

  const [name, setName] = useState(prefill?.name ?? '');
  const [email, setEmail] = useState(prefill?.email ?? '');
  const [phone, setPhone] = useState(prefill?.phone ?? '');
  const [practiceType, setPracticeType] = useState(prefill?.practice_type ?? '');
  const [patientFlow, setPatientFlow] = useState(prefill?.patient_flow ?? '');
  const [notes, setNotes] = useState('');
  const [booking, setBooking] = useState(false);

  const loadSlots = useCallback(
    async (day: string) => {
      setSlots(null);
      setSlotsError(null);
      setSlot(null);
      try {
        setSlots(await fetchBookingSlots(day, timezone));
      } catch (e) {
        setSlotsError(e instanceof ApiError ? e.message : 'Could not load slots.');
        setSlots([]);
      }
    },
    [timezone],
  );

  useEffect(() => {
    void loadSlots(date);
  }, [date, loadSlots]);

  const practiceTypeOptions = useMemo(() => {
    const opts: string[] = [...PRACTICE_TYPES];
    if (practiceType && !opts.includes(practiceType)) opts.unshift(practiceType);
    return opts;
  }, [practiceType]);

  const patientFlowOptions = useMemo(() => {
    const opts: string[] = [...PATIENT_FLOW_OPTIONS];
    if (patientFlow && !opts.includes(patientFlow)) opts.unshift(patientFlow);
    return opts;
  }, [patientFlow]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!slot) {
      toast('error', 'Pick a time slot first.');
      return;
    }
    if (!name.trim()) {
      toast('error', 'Name is required.');
      return;
    }
    if (!isValidEmail(email)) {
      toast('error', 'Enter a valid email address.');
      return;
    }
    if (!phone.trim()) {
      toast('error', 'Phone is required.');
      return;
    }
    if (!practiceType || !patientFlow) {
      toast('error', 'Select the practice type and patient flow.');
      return;
    }
    setBooking(true);
    try {
      await api.createAppointment({
        start: slot.start,
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        practice_type: practiceType,
        patient_flow: patientFlow,
        notes: notes.trim() || undefined,
        timezone,
      });
      toast('success', `Meeting booked for ${fmtTime(slot.start)} — confirmation email sent.`);
      onBooked();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast('error', 'That slot was just taken — pick another time.');
        await loadSlots(date);
      } else {
        toast('error', err instanceof ApiError ? err.message : 'Booking failed.');
      }
    } finally {
      setBooking(false);
    }
  };

  return (
    <Modal title="New appointment" onClose={onClose} wide>
      <form onSubmit={submit} className="form-grid">
        <div className="field-row">
          <label className="field">
            <span className="field-label">Day</span>
            <select value={date} onChange={(e) => setDate(e.target.value)}>
              {Array.from({ length: 14 }, (_, i) => (
                <option key={i} value={isoDay(i)}>
                  {dayLabel(i)}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span className="field-label">Timezone</span>
            <div className="stage-chip picker-tz">{timezone}</div>
          </div>
        </div>

        <div className="field">
          <span className="field-label">Available times</span>
          {slotsError ? (
            <p className="help-text">{slotsError}</p>
          ) : slots === null ? (
            <Spinner label="Loading slots…" />
          ) : slots.length === 0 ? (
            <p className="help-text">No free slots on this day — try another date.</p>
          ) : (
            <div className="slot-grid">
              {slots.map((s) => (
                <button
                  key={s.start}
                  type="button"
                  className={slot?.start === s.start ? 'day-chip active' : 'day-chip'}
                  onClick={() => setSlot(s)}
                >
                  {fmtTime(s.start)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="field-row">
          <label className="field">
            <span className="field-label">Name *</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dr. Jane Doe" required />
          </label>
          <label className="field">
            <span className="field-label">Email *</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="doctor@practice.com"
              required
            />
          </label>
        </div>
        <div className="field-row">
          <label className="field">
            <span className="field-label">Phone *</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(305) 555-0100" required />
          </label>
          <label className="field">
            <span className="field-label">Practice type *</span>
            <select value={practiceType} onChange={(e) => setPracticeType(e.target.value)} required>
              <option value="" disabled>
                Select…
              </option>
              {practiceTypeOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Patient flow *</span>
            <select value={patientFlow} onChange={(e) => setPatientFlow(e.target.value)} required>
              <option value="" disabled>
                Select…
              </option>
              {patientFlowOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span className="field-label">Notes</span>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything worth knowing before the call…"
          />
        </label>

        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={booking || !slot}>
            {booking ? 'Booking…' : slot ? `Book ${fmtTime(slot.start)}` : 'Pick a slot'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
