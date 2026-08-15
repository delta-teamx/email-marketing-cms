import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { supabase } from '../lib/supabase';
import { useWorkspace } from '../context/AuthContext';
import { useToast } from '../hooks/toast';
import { Modal } from './Modal';
import { ContactPicker } from './ContactPicker';
import { Spinner } from './ui';
import { contactName } from '../lib/format';
import type { ContactSummary, ContractTemplateRow } from '../lib/types';

/**
 * "Send contract" flow: pick a contact and template, optionally override the
 * practice name/address merge values, then create + email the contract via
 * the API. Reachable from the Contracts page and a contact's detail page.
 */
export function SendContractModal({
  contact: initialContact,
  onClose,
  onSent,
}: {
  /** Pre-selected contact (from the contact detail page). */
  contact?: ContactSummary;
  onClose: () => void;
  onSent: () => void;
}) {
  const workspace = useWorkspace();
  const toast = useToast();

  const [contact, setContact] = useState<ContactSummary | null>(initialContact ?? null);
  const [templates, setTemplates] = useState<ContractTemplateRow[] | null>(null);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [practiceName, setPracticeName] = useState('');
  const [practiceAddress, setPracticeAddress] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    void (async () => {
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
      const rows = (data ?? []) as ContractTemplateRow[];
      setTemplates(rows);
      if (rows.length > 0) setTemplateId((current) => current || rows[0].id);
    })();
  }, [workspace.id]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!contact) {
      toast('error', 'Pick a contact first.');
      return;
    }
    if (!templateId) {
      toast('error', 'Pick a contract template.');
      return;
    }
    setSending(true);
    try {
      const result = await api.createContract({
        contact_id: contact.id,
        template_id: templateId,
        practice_name: practiceName.trim() || undefined,
        practice_address: practiceAddress.trim() || undefined,
      });
      let copied = false;
      try {
        await navigator.clipboard.writeText(result.sign_url);
        copied = true;
      } catch {
        // clipboard unavailable (permissions) — the link is still in the table
      }
      toast(
        'success',
        `Contract emailed to ${contactName(contact)}.${copied ? ' Sign link copied to clipboard.' : ` Sign link: ${result.sign_url}`}`,
      );
      onSent();
      onClose();
    } catch (err) {
      toast('error', err instanceof ApiError ? err.message : 'Could not send the contract.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal title="Send a contract" onClose={onClose}>
      <form onSubmit={submit} className="form-grid">
        <div className="field">
          <span className="field-label">Contact</span>
          <ContactPicker value={contact} onChange={setContact} autoFocus={!initialContact} />
        </div>

        <label className="field">
          <span className="field-label">Template</span>
          {templatesError ? (
            <p className="help-text">Could not load templates: {templatesError}</p>
          ) : templates === null ? (
            <Spinner label="Loading templates…" />
          ) : templates.length === 0 ? (
            <p className="help-text">No contract templates yet — create one on the Contracts page.</p>
          ) : (
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          )}
        </label>

        <label className="field">
          <span className="field-label">Practice name (optional override)</span>
          <input
            value={practiceName}
            onChange={(e) => setPracticeName(e.target.value)}
            placeholder="Fills {{practice_name}} in the contract"
          />
        </label>
        <label className="field">
          <span className="field-label">Practice address (optional override)</span>
          <input
            value={practiceAddress}
            onChange={(e) => setPracticeAddress(e.target.value)}
            placeholder="Fills {{practice_address}} in the contract"
          />
        </label>

        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={sending || !contact || !templateId}>
            {sending ? 'Sending…' : 'Send for signature'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
