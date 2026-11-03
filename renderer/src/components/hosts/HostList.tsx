/**
 * Host list — the saved hosts of the sidebar.
 *
 * The list talks to the storage through the preload API only.
 */
import { useCallback, useEffect, useState } from 'react'
import { ProtocolType, type Host } from '@shared/types'
import { api } from '../../services/api'

export interface HostListProps {
  /** Called when the list changed, so other panels can refresh. */
  onChanged?: () => void
  /** Called when the user picks a host to connect to. */
  onConnect?: (host: Host) => void
}

const PROTOCOL_LABELS: Record<ProtocolType, string> = {
  [ProtocolType.SSH]: 'SSH',
  [ProtocolType.SFTP]: 'SFTP',
  [ProtocolType.FTP]: 'FTP',
  [ProtocolType.TELNET]: 'Telnet',
  [ProtocolType.SERIAL]: 'Serial',
  [ProtocolType.LOCAL]: 'Local'
}

export function HostList({ onChanged, onConnect }: HostListProps) {
  const [hosts, setHosts] = useState<Host[]>([])
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

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

  if (hosts.length === 0) {
    return <div className="sidebar__empty">No hosts yet</div>
  }

  return (
    <div className="host-list">
      {error ? <div className="keychain-panel__error">{error}</div> : null}

      {hosts.map((host) => (
        <div key={host.id} className="host-list__item">
          <div
            className="host-list__item-head"
            onClick={() => setExpanded(expanded === host.id ? null : host.id)}
          >
            <span className="host-list__name">{host.name}</span>
            <span className="host-list__protocol">
              {PROTOCOL_LABELS[host.protocol] ?? host.protocol}
            </span>
          </div>

          <div className="host-list__target">
            {host.username}@{host.host}:{host.port}
          </div>

          {expanded === host.id ? (
            <div className="host-list__detail">
              {host.notes ? <div className="host-list__notes">{host.notes}</div> : null}
              <div className="host-list__actions">
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => onConnect?.(host)}
                >
                  Connect
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => void remove(host.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}
