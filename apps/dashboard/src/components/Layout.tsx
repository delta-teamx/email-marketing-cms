import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function NavIcon({ name }: { name: 'campaigns' | 'inbox' | 'suppression' }) {
  const paths: Record<string, JSX.Element> = {
    campaigns: (
      <>
        <rect x="3" y="4" width="18" height="4" rx="1" />
        <rect x="3" y="10" width="18" height="4" rx="1" />
        <rect x="3" y="16" width="12" height="4" rx="1" />
      </>
    ),
    inbox: (
      <>
        <path d="M3 12l3-7h12l3 7v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
        <path d="M3 12h5l2 3h4l2-3h5" />
      </>
    ),
    suppression: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m6 6 12 12" />
      </>
    ),
  };
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export function Layout() {
  const { session, workspace, signOut } = useAuth();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="wordmark">
          <span className="wordmark-mark" aria-hidden="true">
            ▮
          </span>
          <span>
            Implenix <em>Marketing</em>
          </span>
        </div>
        {workspace && <div className="workspace-name">{workspace.name}</div>}
        <nav className="nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            <NavIcon name="campaigns" />
            Campaigns
          </NavLink>
          <NavLink to="/inbox" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            <NavIcon name="inbox" />
            Approval Inbox
          </NavLink>
          <NavLink
            to="/suppression"
            className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
          >
            <NavIcon name="suppression" />
            Suppression List
          </NavLink>
        </nav>
        <div className="sidebar-foot">
          <div className="user-email" title={session?.user.email ?? ''}>
            {session?.user.email}
          </div>
          <button type="button" className="btn btn-small btn-ghost" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
