/** Formatting helpers shared across pages. */

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Local time of day, e.g. "2:30 PM". */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "42.3%" of numerator over denominator, or em dash when the denominator is 0. */
export function rate(numerator: number, denominator: number): string {
  if (!denominator) return '—';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

export function fmtNumber(n: number): string {
  return n.toLocaleString();
}

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
});

/** "$1,234.50" from an integer amount in cents. */
export function fmtMoney(cents: number): string {
  return usd.format(cents / 100);
}

export function fullName(first: string | null | undefined, last: string | null | undefined): string {
  return [first, last].filter(Boolean).join(' ');
}

/** Best display name for a contact-ish record, falling back to the email. */
export function contactName(
  c: { first_name?: string | null; last_name?: string | null; email?: string | null } | null | undefined,
): string {
  if (!c) return 'Unknown contact';
  return fullName(c.first_name, c.last_name) || c.email || 'Unknown contact';
}

/** Human offset for follow-up steps: 90 → "1.5 hours", 30 → "30 minutes". */
export function fmtOffset(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = minutes / 60;
  const rounded = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
  return `${rounded} hour${hours === 1 ? '' : 's'}`;
}

/** Escape a value for a CSV cell (RFC 4180). */
export function csvCell(value: string | null | undefined): string {
  const v = value ?? '';
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function downloadBlob(filename: string, content: string, mime = 'text/csv'): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
