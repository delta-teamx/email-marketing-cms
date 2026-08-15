import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useWorkspace } from '../context/AuthContext';
import { contactName } from '../lib/format';
import type { ContactStage, ContactSummary } from '../lib/types';

/**
 * Searchable contact select: type to search the workspace's contacts by
 * name/email, click a result to pick it. Optionally restricted to a stage.
 */
export function ContactPicker({
  value,
  onChange,
  stage,
  autoFocus,
}: {
  value: ContactSummary | null;
  onChange: (contact: ContactSummary | null) => void;
  /** When set, only contacts in this stage are listed. */
  stage?: ContactStage | null;
  autoFocus?: boolean;
}) {
  const workspace = useWorkspace();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ContactSummary[] | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!open) return;
    const mySeq = ++seq.current;
    setError(null);
    const timer = window.setTimeout(() => {
      void (async () => {
        let req = supabase
          .from('contacts')
          .select('id, email, first_name, last_name, phone, practice_type, patient_flow, stage')
          .eq('workspace_id', workspace.id);
        if (stage) req = req.eq('stage', stage);
        const q = query.trim().replace(/[,%()]/g, '');
        if (q) {
          req = req.or(`email.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%`);
        }
        const { data, error: err } = await req.order('created_at', { ascending: false }).limit(15);
        if (mySeq !== seq.current) return;
        if (err) {
          setError(err.message);
          setResults([]);
        } else {
          setResults((data ?? []) as ContactSummary[]);
        }
      })();
    }, 220);
    return () => window.clearTimeout(timer);
  }, [open, query, stage, workspace.id]);

  if (value) {
    return (
      <div className="picker-chosen">
        <div className="picker-chosen-main">
          <span className="picker-chosen-name">{contactName(value)}</span>
          <span className="picker-chosen-email mono">{value.email}</span>
        </div>
        <button
          type="button"
          className="btn btn-small"
          onClick={() => {
            onChange(null);
            setQuery('');
            setResults(null);
            setOpen(false);
          }}
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="picker">
      <input
        type="search"
        value={query}
        autoFocus={autoFocus}
        placeholder="Search contacts by name or email…"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
      />
      {open && (
        <div className="picker-list" role="listbox">
          {error ? (
            <div className="picker-empty">Search failed: {error}</div>
          ) : results === null ? (
            <div className="picker-empty">Searching…</div>
          ) : results.length === 0 ? (
            <div className="picker-empty">
              {stage ? 'No matching contacts in that stage.' : 'No matching contacts.'}
            </div>
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                className="picker-item"
                role="option"
                aria-selected={false}
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
              >
                <span className="picker-item-name">{contactName(c)}</span>
                <span className="picker-item-email mono">{c.email}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
