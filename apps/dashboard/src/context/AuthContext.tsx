import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export interface Workspace {
  id: string;
  name: string;
}

interface AuthContextValue {
  session: Session | null;
  /** True until the initial session (and workspace, when signed in) is resolved. */
  loading: boolean;
  workspace: Workspace | null;
  workspaceError: string | null;
  signOut: () => Promise<void>;
  reloadWorkspace: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setSessionReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setSessionReady(true);
      if (!next) {
        setWorkspace(null);
        setWorkspaceError(null);
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const loadWorkspace = useCallback(async () => {
    setWorkspaceError(null);
    const { data, error } = await supabase
      .from('workspace_members')
      .select('workspace_id, workspaces ( id, name )')
      .limit(1)
      .maybeSingle();
    if (error) {
      setWorkspaceError(error.message);
      setWorkspace(null);
    } else if (!data) {
      setWorkspaceError('No workspace found for this account.');
      setWorkspace(null);
    } else {
      const row = data as unknown as {
        workspace_id: string;
        workspaces: { id: string; name: string } | null;
      };
      setWorkspace({
        id: row.workspace_id,
        name: row.workspaces?.name ?? 'My workspace',
      });
    }
  }, []);

  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (userId) void loadWorkspace();
  }, [userId, loadWorkspace]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  // Stay in the loading state while signed in but before the workspace fetch
  // has resolved (either into a workspace or an error).
  const loading =
    !sessionReady || (session !== null && workspace === null && workspaceError === null);

  return (
    <AuthContext.Provider
      value={{ session, loading, workspace, workspaceError, signOut, reloadWorkspace: loadWorkspace }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Convenience: current workspace, guaranteed non-null inside authed routes. */
export function useWorkspace(): Workspace {
  const { workspace } = useAuth();
  if (!workspace) throw new Error('useWorkspace called outside an authenticated route');
  return workspace;
}
