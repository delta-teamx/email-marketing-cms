import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

type IconName =
  | 'dashboard'
  | 'appointments'
  | 'contacts'
  | 'followups'
  | 'contracts'
  | 'payments'
  | 'inbox'
  | 'suppression';

function NavIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, JSX.Element> = {
    dashboard: (
      <>
        <rect x="3" y="3" width="8" height="8" rx="1" />
        <rect x="13" y="3" width="8" height="5" rx="1" />
        <rect x="13" y="10" width="8" height="11" rx="1" />
        <rect x="3" y="13" width="8" height="8" rx="1" />
      </>
    ),
    appointments: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 9h18" />
        <path d="M8 3v4M16 3v4" />
        <path d="m9.5 14.5 2 2 3.5-3.5" />
      </>
    ),
    contacts: (
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
        <path d="M16 5a3.5 3.5 0 0 1 0 6.6" />
        <path d="M17.5 14.4c2.1.8 3.5 2.9 3.5 5.6" />
      </>
    ),
    followups: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 7 9 6 9-6" />
      </>
    ),
    contracts: (
      <>
        <path d="M6 2h9l4 4v16H6z" />
        <path d="M15 2v4h4" />
        <path d="M9 12h6M9 16h4" />
      </>
    ),
    payments: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v10" />
        <path d="M15 9.5c0-1.4-1.3-2.2-3-2.2s-3 .8-3 2.2 1.2 1.9 3 2.5 3 1.1 3 2.5-1.3 2.2-3 2.2-3-.8-3-2.2" />
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

const NAV_ITEMS: { to: string; end?: boolean; icon: IconName; label: string }[] = [
  { to: '/', end: true, icon: 'dashboard', label: 'Dashboard' },
  { to: '/appointments', icon: 'appointments', label: 'Appointments' },
  { to: '/contacts', icon: 'contacts', label: 'Contacts' },
  { to: '/followups', icon: 'followups', label: 'Follow-ups' },
  { to: '/contracts', icon: 'contracts', label: 'Contracts' },
  { to: '/payments', icon: 'payments', label: 'Payments' },
  { to: '/inbox', icon: 'inbox', label: 'Inbox' },
  { to: '/suppression', icon: 'suppression', label: 'Suppression' },
];

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
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              <NavIcon name={item.icon} />
              {item.label}
            </NavLink>
          ))}
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
