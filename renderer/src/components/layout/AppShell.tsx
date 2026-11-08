import { useCallback, useState, type ReactNode } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { Logo } from './Logo'
import { KeychainPanel } from '../keys/KeychainPanel'
import { HostList } from '../hosts/HostList'
import { LoginForm } from '../auth/LoginForm'
import { SyncPanel } from '../sync/SyncPanel'
import { SettingsPanel } from '../settings/SettingsPanel'
import { TransferPanel } from '../transfer/TransferPanel'

interface AppShellProps {
  children?: ReactNode
  /** The email of the signed-in account, or null when signed out. */
  signedInAs?: string | null
  /** Called after a successful sign-in. */
  onSignIn?: (email: string) => void
  /** Called when the user signs out. */
  onSignOut?: () => void
}

type SidebarSection = 'hosts' | 'keychain' | 'sync' | 'transfer' | 'settings'

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
  const { t } = useI18n()

  return (
    <header className="app-shell__topbar topbar">
      <div className="topbar__brand">
        <Logo size={26} variant="emblem" />
        <span className="topbar__title">{t('app.title')}</span>
        <span className="topbar__divider" />
        <span className="topbar__subtitle">{t('app.subtitle')}</span>
      </div>
      <div className="topbar__actions">
        <button type="button" className="topbar__button" disabled>
          {t('app.connect')}
        </button>
        <div className="topbar__status" title={t('app.syncStatus')}>
          <span className={`status-dot status-dot--${signedInAs ? 'ok' : 'idle'}`} />
          <span className="topbar__status-label">
            {signedInAs ? signedInAs : t('app.offline')}
          </span>
        </div>
        {signedInAs && onSignOut ? (
          <button type="button" className="topbar__button" onClick={onSignOut}>
            {t('app.signOut')}
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
  const { t } = useI18n()

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
          {t('nav.hosts')}
        </button>
        <button
          type="button"
          className={`sidebar__item${section === 'keychain' ? ' sidebar__item--active' : ''}`}
          onClick={() => onSelect('keychain')}
        >
          {t('nav.keychain')}
        </button>
        <button
          type="button"
          className={`sidebar__item${section === 'sync' ? ' sidebar__item--active' : ''}`}
          onClick={() => onSelect('sync')}
        >
          {t('nav.sync')}
        </button>
        <button
          type="button"
          className={`sidebar__item${section === 'transfer' ? ' sidebar__item--active' : ''}`}
          onClick={() => onSelect('transfer')}
        >
          {t('nav.export')}
        </button>
        <button
          type="button"
          className={`sidebar__item${section === 'settings' ? ' sidebar__item--active' : ''}`}
          onClick={() => onSelect('settings')}
        >
          {t('nav.settings')}
        </button>
      </nav>

      {section === 'settings' ? (
        <div className="sidebar__section">
          <div className="sidebar__section-header">{t('settings.title')}</div>
          {signedInAs ? (
            <SettingsPanel signedInAs={signedInAs} />
          ) : (
            <>
              <LoginForm onSignedIn={onSignIn} />
              <SettingsPanel />
            </>
          )}
        </div>
      ) : section === 'sync' ? (
        <div className="sidebar__section">
          <div className="sidebar__section-header">{t('nav.sync')}</div>
          <SyncPanel />
        </div>
      ) : section === 'transfer' ? (
        <div className="sidebar__section">
          <div className="sidebar__section-header">{t('nav.export')}</div>
          <TransferPanel />
        </div>
      ) : section === 'keychain' ? (
        <div className="sidebar__section">
          <div className="sidebar__section-header">{t('nav.keychain')}</div>
          <KeychainPanel onKeysChanged={handleKeysChanged} />
        </div>
      ) : section === 'hosts' ? (
        <div className="sidebar__section">
          <div className="sidebar__section-header">{t('nav.hosts')}</div>
          <HostList />
        </div>
      ) : null}
    </aside>
  )
}
