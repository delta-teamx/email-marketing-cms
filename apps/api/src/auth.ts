import type { FastifyRequest, FastifyReply } from 'fastify';
import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';
import { db } from './db.js';

const authClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export interface AuthedUser {
  id: string;
  email: string | null;
  workspaceIds: string[];
}

/**
 * Verify the Supabase access token from the Authorization header and load the
 * caller's workspace memberships. Replies 401 and returns null on failure.
 */
export async function requireUser(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthedUser | null> {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    reply.code(401).send({ error: 'missing_token' });
    return null;
  }
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) {
    reply.code(401).send({ error: 'invalid_token' });
    return null;
  }
  const { data: memberships } = await db
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', data.user.id);
  return {
    id: data.user.id,
    email: data.user.email ?? null,
    workspaceIds: (memberships ?? []).map((m) => m.workspace_id as string),
  };
}

/** 404s (not 403 — avoid existence leaks) unless the user is in the workspace. */
export function assertWorkspace(
  user: AuthedUser,
  workspaceId: string,
  reply: FastifyReply,
): boolean {
  if (!user.workspaceIds.includes(workspaceId)) {
    reply.code(404).send({ error: 'not_found' });
    return false;
  }
  return true;
}
