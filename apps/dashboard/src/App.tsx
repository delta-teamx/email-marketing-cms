import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './hooks/toast';
import { ConfirmProvider } from './hooks/confirm';
import { Layout } from './components/Layout';
import { Spinner, ErrorBanner } from './components/ui';
import { LoginPage } from './pages/LoginPage';
import { CampaignsPage } from './pages/CampaignsPage';
import { CampaignDetailPage } from './pages/CampaignDetailPage';
import { InboxPage } from './pages/InboxPage';
import { SuppressionPage } from './pages/SuppressionPage';

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading, workspace, workspaceError, reloadWorkspace, signOut } = useAuth();

  if (loading) {
    return (
      <div className="fullpage-center">
        <Spinner label="Loading your workspace…" />
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  if (!workspace) {
    return (
      <div className="fullpage-center">
        <div className="auth-card">
          <ErrorBanner
            message={workspaceError ?? 'Could not load your workspace.'}
            onRetry={() => void reloadWorkspace()}
          />
          <button type="button" className="btn" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <ConfirmProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                element={
                  <RequireAuth>
                    <Layout />
                  </RequireAuth>
                }
              >
                <Route path="/" element={<CampaignsPage />} />
                <Route path="/campaigns/:id" element={<CampaignDetailPage />} />
                <Route path="/campaigns/:id/:tab" element={<CampaignDetailPage />} />
                <Route path="/inbox" element={<InboxPage />} />
                <Route path="/suppression" element={<SuppressionPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ConfirmProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
