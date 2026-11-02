/**
 * Remote file manager panel.
 *
 * Renders the directory listing of a file-manager session (SFTP today, FTP
 * later) and drives the transfers. The component never talks to SSH — it
 * goes through the preload API only.
 */
import { useCallback, useEffect, useState } from 'react'
import type { RemoteFileEntry, RemoteListing } from '@shared/types'
import { api } from '../../services/api'

export interface FileManagerProps {
  /** The session id the panel is bound to. */
  sessionId: string
  /** Called when the session dies and the panel should offer a reconnect. */
  onError?: (message: string) => void
}

type Status = { kind: 'idle' } | { kind: 'busy'; text: string } | { kind: 'error'; text: string }

const PATH_SEPARATOR = '/'

/** Formats a byte count for the size column. */
function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/** Formats an ISO timestamp as a short local date. */
function formatDate(iso: string): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString()
}

export function FileManager({ sessionId, onError }: FileManagerProps) {
  const [listing, setListing] = useState<RemoteListing | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [selected, setSelected] = useState<string | null>(null)

  const load = useCallback(
    async (path: string) => {
      setStatus({ kind: 'busy', text: 'Loading…' })
      try {
        const result = await api.file.list({ sessionId, path })
        setListing(result)
        setSelected(null)
        setStatus({ kind: 'idle' })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setStatus({ kind: 'error', text: message })
        onError?.(message)
      }
    },
    [sessionId, onError]
  )

  // Initial listing right after the session connects. The load is deferred
  // into a microtask so the effect body itself never sets state.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      await Promise.resolve()
      if (!cancelled) await load('')
    })()
    return () => {
      cancelled = true
    }
  }, [load])

  const openEntry = useCallback(
    async (entry: RemoteFileEntry) => {
      if (entry.type !== 'd') return
      await load(entry.path)
    },
    [load]
  )

  const goUp = useCallback(async () => {
    if (!listing) return
    await load(listing.parentPath)
  }, [listing, load])

  const download = useCallback(
    async (entry: RemoteFileEntry) => {
      const localPath = await api.file.pickLocalPath({ mode: 'save', defaultPath: entry.name })
      if (!localPath) return

      setStatus({ kind: 'busy', text: `Downloading ${entry.name}…` })
      try {
        await api.file.download({ sessionId, remotePath: entry.path, localPath })
        setStatus({ kind: 'idle' })
      } catch (error) {
        setStatus({
          kind: 'error',
          text: error instanceof Error ? error.message : String(error)
        })
      }
    },
    [sessionId]
  )

  const upload = useCallback(async () => {
    const localPath = await api.file.pickLocalPath({ mode: 'open' })
    if (!localPath) return

    const name = localPath.split(/[\\/]/).pop() ?? 'upload'
    const remotePath = listing ? `${listing.path}${PATH_SEPARATOR}${name}` : name

    setStatus({ kind: 'busy', text: `Uploading ${name}…` })
    try {
      await api.file.upload({ sessionId, remotePath, localPath })
      await load(listing?.path ?? '')
      setStatus({ kind: 'idle' })
    } catch (error) {
      setStatus({
        kind: 'error',
        text: error instanceof Error ? error.message : String(error)
      })
    }
  }, [listing, load, sessionId])

  const entries = listing?.entries ?? []

  return (
    <div className="file-manager">
      <div className="file-manager__toolbar">
        <button
          type="button"
          className="button button--ghost"
          onClick={() => void goUp()}
          disabled={!listing || listing.parentPath === listing.path}
        >
          ↑ Up
        </button>
        <span className="file-manager__path" title={listing?.path ?? '/'}>
          {listing?.path ?? '/'}
        </span>
        <button type="button" className="button button--ghost" onClick={() => void upload()}>
          ↑ Upload
        </button>
      </div>

      {status.kind === 'busy' ? (
        <div className="file-manager__status">{status.text}</div>
      ) : null}
      {status.kind === 'error' ? (
        <div className="file-manager__status file-manager__status--error">{status.text}</div>
      ) : null}

      <div className="file-manager__list" role="table">
        <div className="file-manager__row file-manager__row--head" role="row">
          <span className="file-manager__cell file-manager__cell--name">Name</span>
          <span className="file-manager__cell file-manager__cell--size">Size</span>
          <span className="file-manager__cell file-manager__cell--mode">Mode</span>
          <span className="file-manager__cell file-manager__cell--date">Modified</span>
          <span className="file-manager__cell file-manager__cell--actions" />
        </div>

        {entries.length === 0 ? (
          <div className="file-manager__empty">Directory is empty</div>
        ) : null}

        {entries.map((entry) => (
          <div
            key={entry.path}
            role="row"
            className={`file-manager__row${
              selected === entry.path ? ' file-manager__row--selected' : ''
            }`}
            onClick={() => setSelected(entry.path)}
            onDoubleClick={() => void openEntry(entry)}
          >
            <span className="file-manager__cell file-manager__cell--name">
              <span
                className={`file-manager__icon file-manager__icon--${entry.type}`}
                aria-hidden="true"
              >
                {entry.type === 'd' ? '📁' : entry.type === 'l' ? '🔗' : '📄'}
              </span>
              {entry.name}
            </span>
            <span className="file-manager__cell file-manager__cell--size">
              {entry.type === 'd' ? '—' : formatSize(entry.size)}
            </span>
            <span className="file-manager__cell file-manager__cell--mode">{entry.mode || '—'}</span>
            <span className="file-manager__cell file-manager__cell--date">
              {formatDate(entry.modifiedAt)}
            </span>
            <span className="file-manager__cell file-manager__cell--actions">
              {entry.type === 'd' ? (
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={(event) => {
                    event.stopPropagation()
                    void openEntry(entry)
                  }}
                >
                  Open
                </button>
              ) : (
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={(event) => {
                    event.stopPropagation()
                    void download(entry)
                  }}
                >
                  Download
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
