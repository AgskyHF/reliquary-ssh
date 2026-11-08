/**
 * Host list — the saved hosts of the sidebar.
 *
 * The left button connects to the host right away. The right button opens
 * the context menu with the commands of the host.
 *
 * The list talks to the storage through the preload API only.
 */
import { useCallback, useEffect, useState } from 'react'
import { ProtocolType, type Host } from '@shared/types'
import { api } from '../../services/api'
import { useI18n } from '../../i18n/I18nProvider'
import { HostForm } from './HostForm'
import { HostContextMenu } from './HostContextMenu'

export interface HostListProps {
  /** Called when the list changed, so other panels can refresh. */
  onChanged?: () => void
  /** Called when the user picks a host to connect to. */
  onConnect?: (host: Host, protocol: ProtocolType) => void
  /** The text of the search field — the list shows the matching hosts. */
  query?: string
}

const PROTOCOL_LABELS: Record<ProtocolType, string> = {
  [ProtocolType.SSH]: 'SSH',
  [ProtocolType.SFTP]: 'SFTP',
  [ProtocolType.FTP]: 'FTP',
  [ProtocolType.TELNET]: 'Telnet',
  [ProtocolType.SERIAL]: 'Serial',
  [ProtocolType.LOCAL]: 'Local'
}

/** The place the context menu opens at. */
interface MenuState {
  host: Host
  x: number
  y: number
}

export function HostList({ onChanged, onConnect, query = '' }: HostListProps) {
  const [hosts, setHosts] = useState<Host[]>([])
  const [error, setError] = useState<string | null>(null)
  // The form is open when it creates a new host, or when it edits one.
  const [formHost, setFormHost] = useState<Host | null | undefined>(undefined)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const { t } = useI18n()

  // The search of the sidebar filters the list by name and address.
  const needle = query.trim().toLowerCase()
  const visible = needle
    ? hosts.filter(
        (host) =>
          host.name.toLowerCase().includes(needle) ||
          host.host.toLowerCase().includes(needle) ||
          host.username.toLowerCase().includes(needle)
      )
    : hosts

  const refresh = useCallback(async () => {
    try {
      setHosts(await api.host.list())
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [onChanged])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await Promise.resolve()
      if (!cancelled) await refresh()
    })()
    return () => {
      cancelled = true
    }
  }, [refresh])

  const remove = useCallback(
    async (id: string) => {
      try {
        await api.host.remove(id)
        await refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [refresh]
  )

  /** The address of the host — what the clipboard gets. */
  const addressOf = useCallback(
    (host: Host) => `${host.username}@${host.host}:${host.port}`,
    []
  )

  const copy = useCallback(
    async (host: Host) => {
      try {
        await navigator.clipboard.writeText(addressOf(host))
        setCopied(host.id)
        setTimeout(() => setCopied(null), 2000)
      } catch {
        // The clipboard is not available — nothing to do.
      }
    },
    [addressOf]
  )

  if (formHost !== undefined) {
    return (
      <HostForm
        host={formHost}
        onSaved={() => {
          setFormHost(undefined)
          void refresh()
        }}
        onCancel={() => setFormHost(undefined)}
      />
    )
  }

  return (
    <div className="host-list">
      {error ? <div className="keychain-panel__error">{error}</div> : null}

      <button
        type="button"
        className="button button--ghost host-list__add"
        onClick={() => setFormHost(null)}
      >
        {t('hosts.add')}
      </button>

      {hosts.length === 0 ? (
        <div className="sidebar__empty">{t('hosts.empty')}</div>
      ) : visible.length === 0 ? (
        <div className="sidebar__empty">{t('hosts.noMatch')}</div>
      ) : null}

      {visible.map((host) => (
        <div
          key={host.id}
          className="host-list__item"
          // The left button connects to the host. The menu takes itself
          // away — the click may have landed on another host.
          onClick={() => {
            setMenu(null)
            onConnect?.(host, host.protocol)
          }}
          // The right button opens the menu with the commands.
          onContextMenu={(event) => {
            event.preventDefault()
            setMenu({ host, x: event.clientX, y: event.clientY })
          }}
          title={t('hosts.connectHint')}
        >
          <div className="host-list__item-head">
            <span className="host-list__name">{host.name}</span>
            <span className="host-list__protocol">
              {PROTOCOL_LABELS[host.protocol] ?? host.protocol}
            </span>
          </div>

          <div className="host-list__target">{addressOf(host)}</div>

          {host.notes ? <div className="host-list__notes">{host.notes}</div> : null}

          {copied === host.id ? (
            <div className="host-list__copied">{t('hosts.copied')}</div>
          ) : null}
        </div>
      ))}

      {menu ? (
        <HostContextMenu
          host={menu.host}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onConnect={(host, protocol) => onConnect?.(host, protocol)}
          onEdit={(host) => setFormHost(host)}
          onDelete={(host) => void remove(host.id)}
          onCopy={(host) => void copy(host)}
        />
      ) : null}
    </div>
  )
}
