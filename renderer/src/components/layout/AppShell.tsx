import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ProtocolType, TabKind } from '@shared/types'
import { useI18n } from '../../i18n/I18nProvider'
import { Logo } from './Logo'
import { KeychainPanel } from '../keys/KeychainPanel'
import { HostList } from '../hosts/HostList'
import { SyncPanel } from '../sync/SyncPanel'
import { SettingsPanel } from '../settings/SettingsPanel'
import { TransferPanel } from '../transfer/TransferPanel'

interface AppShellProps {
  children?: ReactNode
  /** The number of the hosts in the list — it reloads them when it grows. */
  hostsVersion?: number
  /**
   * Opens a tab for a saved host. The sidebar needs it to connect to a
   * host — the tabs themselves live in the main area.
   */
  onOpenHost?: (
    host: { id: string; host: string; port: number; username: string },
    protocol: TabKind
  ) => void
}

type SidebarSection = 'hosts' | 'keychain' | 'sync' | 'transfer' | 'settings'

/**
 * Root layout: TopBar + Sidebar + MainArea.
 * The MainArea content (tabs, panels) is owned by the children —
 * new panels are added inside the regions below, the shell stays untouched.
 */
export function AppShell({ children, onOpenHost, hostsVersion }: AppShellProps) {
  const [section, setSection] = useState<SidebarSection>('hosts')

  return (
    <div className="app-shell">
      <TopBar />
      <Sidebar
        section={section}
        onSelect={setSection}
        onOpenHost={onOpenHost}
        hostsVersion={hostsVersion}
      />
      <main className="app-shell__main">{children}</main>
    </div>
  )
}

function TopBar() {
  const { t } = useI18n()

  return (
    <header className="app-shell__topbar topbar">
      <div className="topbar__brand">
        <Logo size={32} variant="emblem" />
        <span className="topbar__title">{t('app.title')}</span>
        <span className="topbar__divider" />
        <span className="topbar__subtitle">{t('app.subtitle')}</span>
      </div>
    </header>
  )
}

/** The icon of a menu item — drawn inline, so no image files are needed. */
function MenuIcon({ name }: { name: SidebarSection }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true
  }

  if (name === 'hosts') {
    // A star, filled — the mark of the mockup.
    return (
      <svg {...common} fill="currentColor" stroke="none">
        <path d="M12 2.6l2.7 5.7 6.2.8-4.5 4.3 1.1 6.2L12 16.8 6.5 19.6l1.1-6.2L3.1 9.1l6.2-.8L12 2.6z" />
      </svg>
    )
  }

  if (name === 'keychain') {
    return (
      <svg {...common}>
        <circle cx="8" cy="12" r="4" />
        <path d="M12 12h9M18 12v3.5M15 12v2.5" />
      </svg>
    )
  }

  if (name === 'sync') {
    return (
      <svg {...common}>
        <path d="M20 11a8 8 0 0 0-14.3-4.6M4 13a8 8 0 0 0 14.3 4.6" />
        <path d="M18 3v4h-4M6 21v-4h4" />
      </svg>
    )
  }

  if (name === 'transfer') {
    // A box with an arrow leaving it — an export.
    return (
      <svg {...common}>
        <path d="M12 15V3M8.5 6.5L12 3l3.5 3.5" />
        <path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
      </svg>
    )
  }

  // A gear: a ring with eight teeth around it.
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 8.9 19a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 5 8.9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9.5a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  )
}

function Sidebar({
  section,
  onSelect,
  onOpenHost,
  hostsVersion
}: {
  section: SidebarSection
  onSelect: (section: SidebarSection) => void
  onOpenHost?: (
    host: { id: string; host: string; port: number; username: string },
    protocol: TabKind
  ) => void
  hostsVersion?: number
}) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement | null>(null)

  // The key list is refreshed by the panel itself when it mounts.
  const handleKeysChanged = useCallback(() => undefined, [])

  // The search takes the focus with the usual shortcut.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const items = useMemo(
    () => [
      { id: 'hosts' as const, label: t('nav.hosts') },
      { id: 'keychain' as const, label: t('nav.keychain') },
      { id: 'sync' as const, label: t('nav.sync') },
      { id: 'transfer' as const, label: t('nav.export') },
      { id: 'settings' as const, label: t('nav.settings') }
    ],
    [t]
  )

  return (
    <aside className="app-shell__sidebar sidebar">
      <div className="sidebar__search">
        <svg
          className="sidebar__search-icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          ref={searchRef}
          className="sidebar__search-input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('search.hosts')}
          aria-label={t('search.hosts')}
        />
        <kbd className="sidebar__search-hint">⌘K</kbd>
      </div>

      <nav className="sidebar__nav">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`sidebar__item${section === item.id ? ' sidebar__item--active' : ''}`}
            onClick={() => onSelect(item.id)}
          >
            <span className="sidebar__item-icon">
              <MenuIcon name={item.id} />
            </span>
            <span className="sidebar__item-label">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar__section">
        {section === 'settings' ? (
          <>
            <div className="sidebar__section-header">{t('settings.title')}</div>
            <SettingsPanel />
          </>
        ) : section === 'sync' ? (
          <>
            <div className="sidebar__section-header">{t('nav.sync')}</div>
            <SyncPanel />
          </>
        ) : section === 'transfer' ? (
          <>
            <div className="sidebar__section-header">{t('nav.export')}</div>
            <TransferPanel />
          </>
        ) : section === 'keychain' ? (
          <>
            <div className="sidebar__section-header">{t('nav.keychain')}</div>
            <KeychainPanel onKeysChanged={handleKeysChanged} />
          </>
        ) : (
          <>
            <div className="sidebar__section-header">{t('hosts.title')}</div>
            <HostList
              query={query}
              version={hostsVersion}
              onConnect={(host, protocol) =>
                onOpenHost?.(
                  host,
                  protocol === ProtocolType.SFTP ? TabKind.SFTP : TabKind.SSH
                )
              }
            />
          </>
        )}
      </div>
    </aside>
  )
}
