import { useCallback, useState, type ReactNode } from 'react'
import { KeychainPanel } from '../keys/KeychainPanel'

interface AppShellProps {
  children?: ReactNode
}

type SidebarSection = 'hosts' | 'keychain' | 'settings'

/**
 * Root layout: TopBar + Sidebar + MainArea.
 * The MainArea content (tabs, panels) is owned by the children —
 * new panels are added inside the regions below, the shell stays untouched.
 */
export function AppShell({ children }: AppShellProps) {
  const [section, setSection] = useState<SidebarSection>('hosts')

  return (
    <div className="app-shell">
      <TopBar />
      <Sidebar section={section} onSelect={setSection} />
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

function Sidebar({
  section,
  onSelect
}: {
  section: SidebarSection
  onSelect: (section: SidebarSection) => void
}) {
  // The key list is refreshed by the panel itself when it mounts.
  const handleKeysChanged = useCallback(() => undefined, [])

  return (
    <aside className="app-shell__sidebar sidebar">
      <nav className="sidebar__nav">
        <button
          type="button"
          className={`sidebar__item${section === 'hosts' ? ' sidebar__item--active' : ''}`}
          onClick={() => onSelect('hosts')}
        >
          Hosts
        </button>
        <button
          type="button"
          className={`sidebar__item${section === 'keychain' ? ' sidebar__item--active' : ''}`}
          onClick={() => onSelect('keychain')}
        >
          Keychain
        </button>
        <button
          type="button"
          className={`sidebar__item${section === 'settings' ? ' sidebar__item--active' : ''}`}
          onClick={() => onSelect('settings')}
        >
          Settings
        </button>
      </nav>

      {section === 'keychain' ? (
        <div className="sidebar__section">
          <div className="sidebar__section-header">Keychain</div>
          <KeychainPanel onKeysChanged={handleKeysChanged} />
        </div>
      ) : section === 'hosts' ? (
        <div className="sidebar__section">
          <div className="sidebar__section-header">Hosts</div>
          <div className="sidebar__empty">No hosts yet</div>
        </div>
      ) : (
        <div className="sidebar__section">
          <div className="sidebar__section-header">Settings</div>
          <div className="sidebar__empty">Settings arrive with the sync backend</div>
        </div>
      )}
    </aside>
  )
}
