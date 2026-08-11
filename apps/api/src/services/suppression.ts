import { normalizeEmail } from '@implenix/shared';
import { db } from '../db.js';

/** True if the email is suppressed globally or for this workspace. */
export async function isSuppressed(email: string, workspaceId: string): Promise<boolean> {
  const { data } = await db
    .from('suppression_list')
    .select('id, workspace_id')
    .eq('email', normalizeEmail(email))
    .limit(10);
  return (data ?? []).some((r) => r.workspace_id === null || r.workspace_id === workspaceId);
}

export async function suppress(
  email: string,
  workspaceId: string | null,
  reason: 'unsubscribe' | 'dnc_reply' | 'hard_bounce' | 'complaint' | 'manual',
): Promise<void> {
  const normalized = normalizeEmail(email);
  // The unique index uses coalesce(workspace_id, zero-uuid) so PostgREST
  // upsert can't target it — check-then-insert and tolerate the race.
  const existing = await db
    .from('suppression_list')
    .select('id, workspace_id')
    .eq('email', normalized);
  const already = (existing.data ?? []).some((r) => (r.workspace_id ?? null) === workspaceId);
  if (!already) {
    const { error } = await db
      .from('suppression_list')
      .insert({ email: normalized, workspace_id: workspaceId, reason });
    if (error && !error.message.includes('duplicate')) throw new Error(error.message);
  }
  // Stop every active lead with this email in the affected scope.
  let q = db
    .from('leads')
    .update({ status: 'suppressed', next_send_at: null })
    .eq('email', normalizeEmail(email))
    .in('status', ['active', 'paused']);
  if (workspaceId) q = q.eq('workspace_id', workspaceId);
  await q;
}
