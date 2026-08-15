import { db } from '../db.js';

/**
 * The platform is effectively single-tenant: public landing-page bookings
 * attach to the primary (oldest) workspace. Cached after first lookup.
 */
let primaryWorkspaceId: string | null = null;

export async function getPrimaryWorkspaceId(): Promise<string> {
  if (primaryWorkspaceId) return primaryWorkspaceId;
  const { data, error } = await db
    .from('workspaces')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    throw new Error(
      'No workspace exists yet — sign up in the dashboard once before taking bookings.',
    );
  }
  primaryWorkspaceId = data.id;
  return data.id;
}

/** Email address of a workspace's owner (for signed-contract notifications). */
export async function getWorkspaceOwnerEmail(workspaceId: string): Promise<string | null> {
  const { data: member } = await db
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle();
  if (!member) return null;
  const { data } = await db.auth.admin.getUserById(member.user_id);
  return data.user?.email ?? null;
}
