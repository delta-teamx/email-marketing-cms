import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { api, ApiError } from '../lib/api';
import { useWorkspace } from '../context/AuthContext';
import { useToast } from '../hooks/toast';
import { useConfirm } from '../hooks/confirm';
import { Modal } from '../components/Modal';
import { ContactPicker } from '../components/ContactPicker';
import { EmptyState, ErrorBanner, Skeleton, StatusPill } from '../components/ui';
import { contactName, fmtDate, fmtDateTime, fmtMoney } from '../lib/format';
import type { ContactSummary, PaymentStatus, PaymentWithContact } from '../lib/types';

const STATUS_FILTERS: ('all' | PaymentStatus)[] = ['all', 'due', 'overdue', 'paid', 'waived'];
const METHODS = ['ach', 'check', 'card', 'wire', 'other'] as const;

interface PaymentForm {
  contact: ContactSummary | null;
  amountDollars: string;
  period: string;
  description: string;
  due_date: string;
  status: PaymentStatus;
  method: string;
  notes: string;
}

const EMPTY_FORM: PaymentForm = {
  contact: null,
  amountDollars: '',
  period: '',
  description: '',
  due_date: '',
  status: 'due',
  method: '',
  notes: '',
};

export function PaymentsPage() {
  const workspace = useWorkspace();
  const toast = useToast();
  const confirm = useConfirm();

  const [payments, setPayments] = useState<PaymentWithContact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | PaymentStatus>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modal, setModal] = useState<{ mode: 'add' } | { mode: 'edit'; payment: PaymentWithContact } | null>(
    null,
  );

  const load = useCallback(async () => {
    setError(null);
    const { data, error: err } = await supabase
      .from('payments')
      .select('*, contacts ( id, email, first_name, last_name )')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false });
    if (err) {
      setError(err.message);
      setPayments([]);
      return;
    }
    setPayments((data ?? []) as unknown as PaymentWithContact[]);
  }, [workspace.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const t = { paid: 0, outstanding: 0, overdue: 0 };
    for (const p of payments ?? []) {
      if (p.status === 'paid') t.paid += p.amount_cents;
      else if (p.status === 'due') t.outstanding += p.amount_cents;
      else if (p.status === 'overdue') {
        t.outstanding += p.amount_cents;
        t.overdue += p.amount_cents;
      }
    }
    return t;
  }, [payments]);

  const visible = useMemo(
    () => (payments ?? []).filter((p) => filter === 'all' || p.status === filter),
    [payments, filter],
  );

  const setStatus = async (payment: PaymentWithContact, status: PaymentStatus) => {
    setBusyId(payment.id);
    const { error: err } = await supabase
      .from('payments')
      .update({
        status,
        paid_at: status === 'paid' ? new Date().toISOString() : null,
      })
      .eq('id', payment.id);
    setBusyId(null);
    if (err) {
      toast('error', `Could not update payment: ${err.message}`);
    } else {
      toast('success', `Payment marked ${status}.`);
      await load();
    }
  };

  const remove = async (payment: PaymentWithContact) => {
    const ok = await confirm({
      title: 'Delete this payment?',
      message: `${fmtMoney(payment.amount_cents)} for ${contactName(payment.contacts)} will be permanently removed from the ledger.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    setBusyId(payment.id);
    const { error: err } = await supabase.from('payments').delete().eq('id', payment.id);
    setBusyId(null);
    if (err) toast('error', `Could not delete payment: ${err.message}`);
    else {
      toast('success', 'Payment deleted.');
      await load();
    }
  };

  const remind = async (payment: PaymentWithContact) => {
    setBusyId(payment.id);
    try {
      await api.remindPayment(payment.id);
      toast('success', `Payment reminder emailed to ${contactName(payment.contacts)}.`);
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Could not send the reminder.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Payments</h1>
          <p className="page-sub">
            The manual ledger for signed clients — record monthly invoices, track what is due, and
            nudge late payers.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setModal({ mode: 'add' })}>
          Add payment
        </button>
      </div>

      <div className="stat-tiles stat-tiles-3">
        <div className="stat-tile">
          <span className="stat-value">{fmtMoney(totals.paid)}</span>
          <span className="stat-label">Total paid</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{fmtMoney(totals.outstanding)}</span>
          <span className="stat-label">Outstanding</span>
        </div>
        <div className="stat-tile">
          <span className={totals.overdue > 0 ? 'stat-value stat-bad' : 'stat-value'}>
            {fmtMoney(totals.overdue)}
          </span>
          <span className="stat-label">Overdue</span>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Ledger</h2>
          <div className="day-picker" role="group" aria-label="Filter by status">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                className={filter === f ? 'day-chip active' : 'day-chip'}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'All' : f}
              </button>
            ))}
          </div>
        </div>

        {error && <ErrorBanner message={error} onRetry={() => void load()} />}

        {payments === null ? (
          <Skeleton rows={5} />
        ) : visible.length === 0 && !error ? (
          <EmptyState
            title={filter === 'all' ? 'No payments recorded' : `No ${filter} payments`}
            hint={
              filter === 'all'
                ? 'Add the first invoice once a client signs.'
                : 'Try a different status filter.'
            }
            action={
              filter === 'all' ? (
                <button type="button" className="btn btn-primary" onClick={() => setModal({ mode: 'add' })}>
                  Add payment
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Description</th>
                  <th className="num">Amount</th>
                  <th>Status</th>
                  <th>Due</th>
                  <th>Paid</th>
                  <th>Method</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.contacts ? (
                        <div className="cell-stack">
                          <Link to={`/contacts/${p.contacts.id}`}>{contactName(p.contacts)}</Link>
                          <span className="dim mono cell-sub">{p.contacts.email}</span>
                        </div>
                      ) : (
                        <span className="dim">—</span>
                      )}
                    </td>
                    <td>
                      <div className="cell-stack">
                        <span>{p.description || '—'}</span>
                        {p.period && <span className="dim cell-sub">{p.period}</span>}
                      </div>
                    </td>
                    <td className="num">{fmtMoney(p.amount_cents)}</td>
                    <td>
                      <StatusPill value={p.status} />
                    </td>
                    <td className="dim">{fmtDate(p.due_date)}</td>
                    <td className="dim">{p.paid_at ? fmtDateTime(p.paid_at) : '—'}</td>
                    <td>{p.method ?? '—'}</td>
                    <td className="row-actions">
                      {p.status !== 'paid' && (
                        <>
                          <button
                            type="button"
                            className="btn btn-small"
                            disabled={busyId === p.id}
                            onClick={() => void setStatus(p, 'paid')}
                          >
                            Mark paid
                          </button>{' '}
                        </>
                      )}
                      {p.status === 'due' && (
                        <>
                          <button
                            type="button"
                            className="btn btn-small"
                            disabled={busyId === p.id}
                            onClick={() => void setStatus(p, 'overdue')}
                          >
                            Mark overdue
                          </button>{' '}
                        </>
                      )}
                      {(p.status === 'due' || p.status === 'overdue') && (
                        <>
                          <button
                            type="button"
                            className="btn btn-small"
                            disabled={busyId === p.id}
                            onClick={() => void setStatus(p, 'waived')}
                          >
                            Waive
                          </button>{' '}
                          <button
                            type="button"
                            className="btn btn-small"
                            disabled={busyId === p.id}
                            onClick={() => void remind(p)}
                          >
                            Send reminder
                          </button>{' '}
                        </>
                      )}
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={() => setModal({ mode: 'edit', payment: p })}
                      >
                        Edit
                      </button>{' '}
                      <button
                        type="button"
                        className="btn btn-small btn-danger-ghost"
                        disabled={busyId === p.id}
                        onClick={() => void remove(p)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modal && (
        <PaymentModal
          payment={modal.mode === 'edit' ? modal.payment : null}
          onClose={() => setModal(null)}
          onSaved={() => void load()}
        />
      )}
    </div>
  );
}

function PaymentModal({
  payment,
  onClose,
  onSaved,
}: {
  payment: PaymentWithContact | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const workspace = useWorkspace();
  const toast = useToast();

  const [form, setForm] = useState<PaymentForm>(() =>
    payment
      ? {
          contact: payment.contacts
            ? {
                ...payment.contacts,
                phone: null,
                practice_type: null,
                patient_flow: null,
                stage: 'closed_won',
              }
            : null,
          amountDollars: (payment.amount_cents / 100).toFixed(2),
          period: payment.period ?? '',
          description: payment.description ?? '',
          due_date: payment.due_date ?? '',
          status: payment.status,
          method: payment.method ?? '',
          notes: payment.notes ?? '',
        }
      : EMPTY_FORM,
  );
  const [onlyClients, setOnlyClients] = useState(true);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!payment && !form.contact) {
      toast('error', 'Pick a contact first.');
      return;
    }
    const dollars = Number(form.amountDollars);
    if (!Number.isFinite(dollars) || dollars < 0) {
      toast('error', 'Enter a valid dollar amount.');
      return;
    }
    const amountCents = Math.round(dollars * 100);
    setSaving(true);
    const fields = {
      amount_cents: amountCents,
      period: form.period || null,
      description: form.description.trim() || null,
      status: form.status,
      due_date: form.due_date || null,
      paid_at: form.status === 'paid' ? (payment?.paid_at ?? new Date().toISOString()) : null,
      method: form.method || null,
      notes: form.notes.trim() || null,
    };
    const { error } = payment
      ? await supabase.from('payments').update(fields).eq('id', payment.id)
      : await supabase.from('payments').insert({
          ...fields,
          workspace_id: workspace.id,
          contact_id: form.contact!.id,
        });
    setSaving(false);
    if (error) {
      toast('error', `Could not save payment: ${error.message}`);
    } else {
      toast('success', payment ? 'Payment updated.' : 'Payment added.');
      onSaved();
      onClose();
    }
  };

  return (
    <Modal title={payment ? 'Edit payment' : 'Add payment'} onClose={onClose}>
      <form onSubmit={submit} className="form-grid">
        {!payment && (
          <div className="field">
            <span className="field-label">Client</span>
            <ContactPicker
              value={form.contact}
              onChange={(contact) => setForm({ ...form, contact })}
              stage={onlyClients ? 'closed_won' : null}
              autoFocus
            />
            {!form.contact && (
              <label className="check-field picker-filter">
                <input
                  type="checkbox"
                  checked={onlyClients}
                  onChange={(e) => setOnlyClients(e.target.checked)}
                />
                <span>Only closed-won clients</span>
              </label>
            )}
          </div>
        )}
        <div className="field-row">
          <label className="field">
            <span className="field-label">Amount</span>
            <div className="input-affix">
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.amountDollars}
                onChange={(e) => setForm({ ...form, amountDollars: e.target.value })}
                placeholder="1500.00"
                required
              />
              <span className="affix">USD</span>
            </div>
          </label>
          <label className="field">
            <span className="field-label">Period</span>
            <input
              type="month"
              value={form.period}
              onChange={(e) => setForm({ ...form, period: e.target.value })}
            />
          </label>
        </div>
        <label className="field">
          <span className="field-label">Description</span>
          <input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Monthly billing service fee"
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span className="field-label">Due date</span>
            <input
              type="date"
              value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">Status</span>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as PaymentStatus })}
            >
              <option value="due">Due</option>
              <option value="paid">Paid</option>
              <option value="overdue">Overdue</option>
              <option value="waived">Waived</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Method</span>
            <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
              <option value="">Not set</option>
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span className="field-label">Notes</span>
          <textarea
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </label>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving || (!payment && !form.contact)}>
            {saving ? 'Saving…' : payment ? 'Save payment' : 'Add payment'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
