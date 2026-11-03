import { useCallback, useState, type ReactNode } from 'react'
import { KeychainPanel } from '../keys/KeychainPanel'
import { HostList } from '../hosts/HostList'
import { LoginForm } from '../auth/LoginForm'

interface AppShellProps {
  children?: ReactNode
  /** The email of the signed-in account, or null when signed out. */
  signedInAs?: string | null
  /** Called after a successful sign-in. */
  onSignIn?: (email: string) => void
  /** Called when the user signs out. */
  onSignOut?: () => void
}

type SidebarSection = 'hosts' | 'keychain' | 'settings'

/**
 * Root layout: TopBar + Sidebar + MainArea.
 * The MainArea content (tabs, panels) is owned by the children —
 * new panels are added inside the regions below, the shell stays untouched.
 */
export function AppShell({
  children,
  signedInAs = null,
  onSignIn,
  onSignOut
}: AppShellProps) {
  const [section, setSection] = useState<SidebarSection>('hosts')

  return (
    <div className="app-shell">
      <TopBar signedInAs={signedInAs} onSignOut={onSignOut} />
      <Sidebar section={section} onSelect={setSection} signedInAs={signedInAs} onSignIn={onSignIn} />
      <main className="app-shell__main">{children}</main>
    </div>
  )
}

function TopBar({
  signedInAs,
  onSignOut
}: {
  signedInAs: string | null
  onSignOut?: () => void
}) {
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
          <span className={`status-dot status-dot--${signedInAs ? 'ok' : 'idle'}`} />
          <span className="topbar__status-label">
            {signedInAs ? signedInAs : 'Offline'}
          </span>
        </div>
        {signedInAs && onSignOut ? (
          <button type="button" className="topbar__button" onClick={onSignOut}>
            Sign out
          </button>
        ) : null}
      </div>
    </header>
  )
}

function Sidebar({
  section,
  onSelect,
  signedInAs,
  onSignIn
}: {
  section: SidebarSection
  onSelect: (section: SidebarSection) => void
  signedInAs: string | null
  onSignIn?: (email: string) => void
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

      {section === 'settings' ? (
        <div className="sidebar__section">
          <div className="sidebar__section-header">Settings</div>
          {signedInAs ? (
            <div className="sidebar__empty">Signed in as {signedInAs}</div>
          ) : (
            <LoginForm onSignedIn={onSignIn} />
          )}
        </div>
      ) : section === 'keychain' ? (
        <div className="sidebar__section">
          <div className="sidebar__section-header">Keychain</div>
          <KeychainPanel onKeysChanged={handleKeysChanged} />
        </div>
      ) : section === 'hosts' ? (
        <div className="sidebar__section">
          <div className="sidebar__section-header">Hosts</div>
          <HostList />
        </div>
      ) : null}
    </aside>
  )
}
