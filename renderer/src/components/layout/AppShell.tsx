import type { ReactNode } from 'react'

interface AppShellProps {
  children?: ReactNode
}

/**
 * Root layout: TopBar + Sidebar + MainArea.
 * The MainArea content (tabs, panels) is owned by the children —
 * new panels are added inside the regions below, the shell stays untouched.
 */
export function AppShell({ children }: AppShellProps) {
  return (
    <div className="app-shell">
      <TopBar />
      <Sidebar />
      <main className="app-shell__main">{children}</main>
    </div>
  )
}

function TopBar() {
  return (
    <header className="app-shell__topbar topbar">
      <div className="topbar__brand">
        <span className="topbar__title">ReliquarySSH</span>
        <span className="topbar__subtitle">terminal client</span>
      </div>
      <div className="topbar__actions">
        <button type="button" className="topbar__button" disabled>
          Connect
        </button>
        <div className="topbar__status" title="Sync status">
          <span className="status-dot status-dot--idle" />
          <span className="topbar__status-label">Offline</span>
        </div>
      </div>
    </header>
  )
}

function Sidebar() {
  return (
    <aside className="app-shell__sidebar sidebar">
      <nav className="sidebar__nav">
        <button type="button" className="sidebar__item sidebar__item--active">
          Hosts
        </button>
        <button type="button" className="sidebar__item">
          Keychain
        </button>
        <button type="button" className="sidebar__item">
          Settings
        </button>
      </nav>
      <div className="sidebar__section">
        <div className="sidebar__section-header">Hosts</div>
        <div className="sidebar__empty">No hosts yet</div>
      </div>
    </aside>
  )
}
