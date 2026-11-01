import type { ReactNode } from 'react'

interface AppShellProps {
  children?: ReactNode
}

/**
 * Root layout: TopBar + Sidebar + MainArea.
 * New panels/tabs are added inside the regions below — the shell itself stays untouched.
 */
export function AppShell({ children }: AppShellProps) {
  return (
    <div className="app-shell">
      <TopBar />
      <Sidebar />
      <main className="app-shell__main">
        <MainArea>{children}</MainArea>
      </main>
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

function MainArea({ children }: AppShellProps) {
  return (
    <section className="main-area">
      <div className="main-area__tabs">
        <div className="tab-bar">
          <div className="tab-bar__empty">No open sessions</div>
        </div>
      </div>
      <div className="main-area__content">{children ?? <EmptyState />}</div>
    </section>
  )
}

function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-state__title">Welcome to ReliquarySSH</div>
      <div className="empty-state__text">
        Add a host from the sidebar to start a terminal session.
      </div>
    </div>
  )
}
