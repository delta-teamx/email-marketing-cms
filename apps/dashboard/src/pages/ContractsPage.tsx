import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { api, ApiError, contractSignUrl } from '../lib/api';
import { useWorkspace } from '../context/AuthContext';
import { useToast } from '../hooks/toast';
import { useConfirm } from '../hooks/confirm';
import { Modal } from '../components/Modal';
import { SendContractModal } from '../components/SendContractModal';
import { EmptyState, ErrorBanner, Skeleton, StatusPill } from '../components/ui';
import { contactName, fmtDateTime } from '../lib/format';
import type { ContractTemplateRow, ContractWithContact } from '../lib/types';

const KIND_LABELS: Record<string, string> = {
  baa: 'BAA',
  service_agreement: 'Service agreement',
  other: 'Other',
};

const TEMPLATE_TAGS = [
  'practice_name',
  'practice_address',
  'effective_date',
  'signer_name',
  'signer_title',
] as const;

export function ContractsPage() {
  const workspace = useWorkspace();
  const toast = useToast();
  const confirm = useConfirm();

  // --- templates ---------------------------------------------------------
  const [templates, setTemplates] = useState<ContractTemplateRow[] | null>(null);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ContractTemplateRow | null>(null);

  const loadTemplates = useCallback(async () => {
    setTemplatesError(null);
    const { data, error } = await supabase
      .from('contract_templates')
      .select('*')
      .eq('workspace_id', workspace.id)
      .order('created_at');
    if (error) {
      setTemplatesError(error.message);
      setTemplates([]);
      return;
    }
    setTemplates((data ?? []) as ContractTemplateRow[]);
  }, [workspace.id]);

  // --- sent contracts ----------------------------------------------------
  const [contracts, setContracts] = useState<ContractWithContact[] | null>(null);
  const [contractsError, setContractsError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const loadContracts = useCallback(async () => {
    setContractsError(null);
    const { data, error } = await supabase
      .from('contracts')
      .select('*, contacts ( id, email, first_name, last_name )')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false });
    if (error) {
      setContractsError(error.message);
      setContracts([]);
      return;
    }
    setContracts((data ?? []) as unknown as ContractWithContact[]);
  }, [workspace.id]);

  useEffect(() => {
    void loadTemplates();
    void loadContracts();
  }, [loadTemplates, loadContracts]);

  const copySignLink = async (contract: ContractWithContact) => {
    const url = contractSignUrl(contract.sign_token);
    try {
      await navigator.clipboard.writeText(url);
      toast('success', 'Sign link copied to clipboard.');
    } catch {
      toast('info', `Sign link: ${url}`);
    }
  };

  const remind = async (contract: ContractWithContact) => {
    setBusyId(contract.id);
    try {
      await api.remindContract(contract.id);
      toast('success', `Reminder emailed to ${contactName(contract.contacts)}.`);
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Could not send the reminder.');
    } finally {
      setBusyId(null);
    }
  };

  const voidContract = async (contract: ContractWithContact) => {
    const ok = await confirm({
      title: 'Void this contract?',
      message: `The sign link stops working and ${contactName(contract.contacts)} can no longer sign. This cannot be undone.`,
      confirmLabel: 'Void contract',
      danger: true,
    });
    if (!ok) return;
    setBusyId(contract.id);
    try {
      await api.voidContract(contract.id);
      toast('success', 'Contract voided.');
      await loadContracts();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Could not void the contract.');
    } finally {
      setBusyId(null);
    }
  };

  const statusDate = (c: ContractWithContact): string => {
    if (c.status === 'signed') return `signed ${fmtDateTime(c.signed_at)}`;
    if (c.status === 'viewed') return `viewed ${fmtDateTime(c.viewed_at)}`;
    if (c.sent_at) return `sent ${fmtDateTime(c.sent_at)}`;
    return `created ${fmtDateTime(c.created_at)}`;
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Contracts</h1>
          <p className="page-sub">
            BAAs and service agreements, e-signed with one click. Edit your templates, send them to
            a contact, and track signature status.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setSending(true)}>
          Send contract
        </button>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Templates</h2>
        </div>
        {templatesError && <ErrorBanner message={templatesError} onRetry={() => void loadTemplates()} />}
        {templates === null ? (
          <Skeleton rows={2} />
        ) : templates.length === 0 && !templatesError ? (
          <EmptyState
            title="No templates"
            hint="A standard BAA and service agreement are seeded for new workspaces."
          />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Kind</th>
                  <th>Updated</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id}>
                    <td>{t.title}</td>
                    <td>
                      <span className="stage-chip">{KIND_LABELS[t.kind] ?? t.kind}</span>
                    </td>
                    <td className="dim">{fmtDateTime(t.updated_at)}</td>
                    <td className="row-actions">
                      <button type="button" className="btn btn-small" onClick={() => setEditing(t)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>
            Sent contracts{' '}
            {contracts !== null && contracts.length > 0 && (
              <span className="count-badge">{contracts.length}</span>
            )}
          </h2>
        </div>
        {contractsError && <ErrorBanner message={contractsError} onRetry={() => void loadContracts()} />}
        {contracts === null ? (
          <Skeleton rows={4} />
        ) : contracts.length === 0 && !contractsError ? (
          <EmptyState
            title="No contracts sent yet"
            hint="Send a BAA or service agreement from here or from a contact's page."
            action={
              <button type="button" className="btn btn-primary" onClick={() => setSending(true)}>
                Send contract
              </button>
            }
          />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Contract</th>
                  <th>Contact</th>
                  <th>Status</th>
                  <th>Sign link</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div className="cell-stack">
                        <span>{c.title}</span>
                        <span className="dim cell-sub">{KIND_LABELS[c.kind] ?? c.kind}</span>
                      </div>
                    </td>
                    <td>
                      {c.contacts ? (
                        <div className="cell-stack">
                          <Link to={`/contacts/${c.contacts.id}`}>{contactName(c.contacts)}</Link>
                          <span className="dim mono cell-sub">{c.contacts.email}</span>
                        </div>
                      ) : (
                        <span className="dim">—</span>
                      )}
                    </td>
                    <td>
                      <div className="cell-stack">
                        <StatusPill value={c.status} />
                        <span className="dim cell-sub">{statusDate(c)}</span>
                      </div>
                    </td>
                    <td>
                      <button type="button" className="btn btn-small" onClick={() => void copySignLink(c)}>
                        Copy link
                      </button>
                    </td>
                    <td className="row-actions">
                      <a
                        className="btn btn-small"
                        href={contractSignUrl(c.sign_token)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View
                      </a>{' '}
                      {(c.status === 'sent' || c.status === 'viewed') && (
                        <>
                          <button
                            type="button"
                            className="btn btn-small"
                            disabled={busyId === c.id}
                            onClick={() => void remind(c)}
                          >
                            Remind
                          </button>{' '}
                        </>
                      )}
                      {c.status !== 'signed' && c.status !== 'voided' && c.status !== 'declined' && (
                        <button
                          type="button"
                          className="btn btn-small btn-danger-ghost"
                          disabled={busyId === c.id}
                          onClick={() => void voidContract(c)}
                        >
                          Void
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <TemplateEditModal
          template={editing}
          onClose={() => setEditing(null)}
          onSaved={() => void loadTemplates()}
        />
      )}
      {sending && (
        <SendContractModal onClose={() => setSending(false)} onSent={() => void loadContracts()} />
      )}
    </div>
  );
}

function TemplateEditModal({
  template,
  onClose,
  onSaved,
}: {
  template: ContractTemplateRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(template.title);
  const [body, setBody] = useState(template.body);
  const [saving, setSaving] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) {
      toast('error', 'Title and body are required.');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('contract_templates')
      .update({ title: title.trim(), body })
      .eq('id', template.id);
    setSaving(false);
    if (error) {
      toast('error', `Could not save template: ${error.message}`);
    } else {
      toast('success', 'Template saved. Applies to contracts sent from now on.');
      onSaved();
      onClose();
    }
  };

  return (
    <Modal title="Edit contract template" onClose={onClose} wide>
      <form onSubmit={save} className="form-grid">
        <label className="field">
          <span className="field-label">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">Body</span>
          <textarea
            className="mono contract-body"
            rows={18}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
          />
        </label>
        <p className="help-text">
          Available tags:{' '}
          {TEMPLATE_TAGS.map((tag, i) => (
            <span key={tag}>
              {i > 0 && ', '}
              <span className="mono">{`{{${tag}}}`}</span>
            </span>
          ))}
          . They are filled at send time; the signer provides their name and title on the sign page.
        </p>
        <p className="help-text">
          <strong>Note:</strong> have your attorney review this template before first use.
        </p>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save template'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
