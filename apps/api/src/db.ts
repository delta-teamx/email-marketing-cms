import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

/** Service-role client — bypasses RLS. Server-side only. */
export const db = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Client bound to an end-user JWT, used to resolve the caller's identity. */
export function userClient(accessToken: string) {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
