import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './hooks/toast';
import { ConfirmProvider } from './hooks/confirm';
import { Layout } from './components/Layout';
import { Spinner, ErrorBanner } from './components/ui';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { AppointmentsPage } from './pages/AppointmentsPage';
import { ContactsPage } from './pages/ContactsPage';
import { ContactDetailPage } from './pages/ContactDetailPage';
import { FollowupsPage } from './pages/FollowupsPage';
import { ContractsPage } from './pages/ContractsPage';
import { PaymentsPage } from './pages/PaymentsPage';
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
                <Route path="/" element={<DashboardPage />} />
                <Route path="/appointments" element={<AppointmentsPage />} />
                <Route path="/contacts" element={<ContactsPage />} />
                <Route path="/contacts/:id" element={<ContactDetailPage />} />
                <Route path="/followups" element={<FollowupsPage />} />
                <Route path="/contracts" element={<ContractsPage />} />
                <Route path="/payments" element={<PaymentsPage />} />
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
