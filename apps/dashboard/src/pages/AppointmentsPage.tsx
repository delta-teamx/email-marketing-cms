import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { api, ApiError } from '../lib/api';
import { useWorkspace } from '../context/AuthContext';
import { useToast } from '../hooks/toast';
import { useConfirm } from '../hooks/confirm';
import { BookAppointmentModal } from '../components/BookAppointmentModal';
import { EmptyState, ErrorBanner, Skeleton, StatusPill } from '../components/ui';
import { contactName, fmtDateTime } from '../lib/format';
import type { AppointmentWithContact } from '../lib/types';

/** Contact-ish display info for a row, falling back to the booking's attendee blob. */
function rowAttendee(appt: AppointmentWithContact): { name: string; email: string } {
  if (appt.contacts) return { name: contactName(appt.contacts), email: appt.contacts.email };
  const a = appt.attendee;
  return {
    name: typeof a.name === 'string' && a.name ? a.name : 'Unknown attendee',
    email: typeof a.email === 'string' ? a.email : '',
  };
}

export function AppointmentsPage() {
  const workspace = useWorkspace();
  const toast = useToast();
  const confirm = useConfirm();

  const [appointments, setAppointments] = useState<AppointmentWithContact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: err } = await supabase
      .from('appointments')
      .select(
        '*, contacts ( id, email, first_name, last_name, phone, practice_type, patient_flow, stage )',
      )
      .eq('workspace_id', workspace.id)
      .order('starts_at', { ascending: false });
    if (err) {
      setError(err.message);
      setAppointments([]);
      return;
    }
    setAppointments((data ?? []) as unknown as AppointmentWithContact[]);
  }, [workspace.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const up: AppointmentWithContact[] = [];
    const done: AppointmentWithContact[] = [];
    for (const a of appointments ?? []) {
      if (new Date(a.starts_at).getTime() >= now && a.outcome === 'pending') up.push(a);
      else done.push(a);
    }
    up.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    return { upcoming: up, past: done };
  }, [appointments]);

  const setOutcome = async (appt: AppointmentWithContact, outcome: 'showed' | 'no_show') => {
    const who = rowAttendee(appt).name;
    const ok = await confirm({
      title: outcome === 'showed' ? 'Mark as showed?' : 'Mark as no-show?',
      message:
        outcome === 'showed'
          ? `${who} showed up — the post-meeting follow-up emails will start sending.`
          : `${who} did not show — the "sorry we missed you" rebooking email will be sent.`,
      confirmLabel: outcome === 'showed' ? 'Showed' : 'No-show',
    });
    if (!ok) return;
    setBusyId(appt.id);
    try {
      await api.setAppointmentOutcome(appt.id, outcome);
      toast('success', `Marked as ${outcome === 'showed' ? 'showed' : 'no-show'}.`);
      await load();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Could not record the outcome.');
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async (appt: AppointmentWithContact) => {
    const ok = await confirm({
      title: 'Cancel this meeting?',
      message: `The calendar event is removed and pending reminder emails for ${rowAttendee(appt).name} are cancelled.`,
      confirmLabel: 'Cancel meeting',
      danger: true,
    });
    if (!ok) return;
    setBusyId(appt.id);
    try {
      await api.cancelAppointment(appt.id);
      toast('success', 'Meeting cancelled.');
      await load();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Could not cancel the meeting.');
    } finally {
      setBusyId(null);
    }
  };

  const renderRows = (rows: AppointmentWithContact[], isUpcoming: boolean) => (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th>Contact</th>
            <th>Practice</th>
            <th>When</th>
            <th>Meet</th>
            <th>Outcome</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((appt) => {
            const who = rowAttendee(appt);
            return (
              <tr key={appt.id}>
                <td>
                  <div className="cell-stack">
                    {appt.contacts ? (
                      <Link to={`/contacts/${appt.contacts.id}`}>{who.name}</Link>
                    ) : (
                      <span>{who.name}</span>
                    )}
                    {who.email && <span className="dim mono cell-sub">{who.email}</span>}
                  </div>
                </td>
                <td>{appt.contacts?.practice_type ?? '—'}</td>
                <td>{fmtDateTime(appt.starts_at)}</td>
                <td>
                  {appt.meet_link ? (
                    <a href={appt.meet_link} target="_blank" rel="noreferrer">
                      Meet link
                    </a>
                  ) : (
                    <span className="dim">—</span>
                  )}
                </td>
                <td>
                  <StatusPill value={appt.outcome} />
                </td>
                <td className="row-actions">
                  {appt.outcome === 'pending' && (
                    <>
                      <button
                        type="button"
                        className="btn btn-small"
                        disabled={busyId === appt.id}
                        onClick={() => void setOutcome(appt, 'showed')}
                      >
                        Showed
                      </button>{' '}
                      <button
                        type="button"
                        className="btn btn-small"
                        disabled={busyId === appt.id}
                        onClick={() => void setOutcome(appt, 'no_show')}
                      >
                        No-show
                      </button>
                      {isUpcoming && (
                        <>
                          {' '}
                          <button
                            type="button"
                            className="btn btn-small btn-danger-ghost"
                            disabled={busyId === appt.id}
                            onClick={() => void cancel(appt)}
                          >
                            Cancel
                          </button>
                        </>
                      )}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Appointments</h1>
          <p className="page-sub">
            Intro calls booked from the site or right here. Mark outcomes after each meeting — that
            is what kicks off the post-meeting follow-up emails.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setBooking(true)}>
          New appointment
        </button>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {appointments === null ? (
        <Skeleton rows={6} />
      ) : (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2>
                Upcoming {upcoming.length > 0 && <span className="count-badge">{upcoming.length}</span>}
              </h2>
            </div>
            {upcoming.length === 0 ? (
              <EmptyState
                title="No upcoming meetings"
                hint="Book one here or wait for the next booking from the site."
                action={
                  <button type="button" className="btn btn-primary" onClick={() => setBooking(true)}>
                    New appointment
                  </button>
                }
              />
            ) : (
              renderRows(upcoming, true)
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Past {past.length > 0 && <span className="count-badge">{past.length}</span>}</h2>
            </div>
            {past.length === 0 ? (
              <EmptyState title="No past meetings yet" hint="Finished meetings show up here with their outcome." />
            ) : (
              renderRows(past, false)
            )}
          </section>
        </>
      )}

      {booking && (
        <BookAppointmentModal onClose={() => setBooking(false)} onBooked={() => void load()} />
      )}
    </div>
  );
}
