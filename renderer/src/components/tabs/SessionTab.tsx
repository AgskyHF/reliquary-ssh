import { useCallback, useEffect, useRef, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { TabPatch } from '@shared/tabs-model'
import { NEW_TAB_TITLE } from '@shared/tabs-model'
import { TabKind, type TabState } from '@shared/types'
import { api } from '../../services/api'
import { useI18n } from '../../i18n/I18nProvider'
import { useSession, type SessionStatus } from '../../hooks/useSession'
import { TerminalView } from '../TerminalView'
import { ConnectForm, type ConnectFormValues } from '../ConnectForm'
import { FileManager } from '../files/FileManager'
import { ThemePanel, ThemeToggle } from '../theme/ThemePanel'

const RESTORE_NOTE = '\r\n— restored from previous session; reconnect to continue —\r\n'

export interface SessionTabProps {
  tab: TabState
  onPatch: (patch: TabPatch) => void
  onSessionState: (sessionId: string, state: SessionStatus['state']) => void
  registerBuffer: (sessionId: string, getter: (() => string) | null) => void
  /** Signals "the screen changed" so the layout save gets scheduled. */
  onActivity: () => void
}

/** Plain-text snapshot of the whole buffer (viewport + scrollback). */
function serializeTerminal(terminal: Terminal | null): string {
  if (!terminal) return ''
  const buffer = terminal.buffer.active
  const lines: string[] = []
  for (let i = 0; i < buffer.length; i++) {
    lines.push(buffer.getLine(i)?.translateToString(true) ?? '')
  }
  // '\r\n' — a bare '\n' would staircase the replay, cursor stays at column 0.
  // Trailing empty viewport rows carry no information; drop them.
  return lines.join('\r\n').replace(/(\r\n)+$/u, '')
}

/**
 * One tab = one independent session. The component owns its xterm instance,
 * its subscription (filtered by sessionId inside useSession) and its
 * reconnect flow. Hidden tabs stay mounted so their terminal state survives.
 *
 * An SFTP tab has no terminal at all — it renders the FileManager instead.
 */
export function SessionTab({
  tab,
  onPatch,
  onSessionState,
  registerBuffer,
  onActivity
}: SessionTabProps) {
  const sessionId = tab.id
  const isFileManager = tab.kind === TabKind.SFTP

  const terminalRef = useRef<Terminal | null>(null)
  // Output that arrives before the terminal is mounted is buffered and replayed.
  const pendingRef = useRef('')
  const restoredRef = useRef(false)
  const hadRestoredBuffer = tab.buffer.length > 0
  const everConnectedRef = useRef(false)

  const [connected, setConnected] = useState(false)
  const [hideRestored, setHideRestored] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [protocol, setProtocol] = useState<'ssh' | 'sftp'>(
    isFileManager ? 'sftp' : 'ssh'
  )
  const { t } = useI18n()

  /** The title of a fresh tab is stored in English — it is translated here. */
  const labelOf = (item: TabState): string =>
    item.title === NEW_TAB_TITLE ? t('tab.newConnection') : item.title

  const handleData = useCallback(
    (chunk: string) => {
      if (terminalRef.current) {
        terminalRef.current.write(chunk)
      } else {
        pendingRef.current += chunk
      }
      onActivity()
    },
    [onActivity]
  )

  const { status, write, resize, disconnect } = useSession({ sessionId, onData: handleData })

  /**
   * A tab that was opened for a saved host connects on its own — the
   * credentials come from the main process, the renderer never sees the
   * password of a saved connection.
   */
  const connectToHost = useCallback(async () => {
    if (!tab.hostId) return

    setConnecting(true)
    setError(null)
    try {
      const host = (await api.host.list()).find((item) => item.id === tab.hostId)
      if (!host) throw new Error('The host is not in the list anymore')

      await api.session.connect({
        sessionId,
        protocol: tab.kind === TabKind.SFTP ? 'sftp' : 'ssh',
        host: host.host,
        port: host.port,
        username: host.username,
        authMethod: host.authMethod,
        keyId: host.keyId,
        hostId: host.id
      })
      everConnectedRef.current = true
      setConnected(true)
      setHideRestored(false)
      onPatch({
        kind: tab.kind === TabKind.SFTP ? TabKind.SFTP : TabKind.SSH,
        title: `${host.username}@${host.host}`,
        hostId: host.id,
        connection: { host: host.host, port: host.port, username: host.username }
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setConnecting(false)
    }
  }, [onPatch, sessionId, tab.hostId, tab.kind])

  const handleReady = useCallback(
    (terminal: Terminal | null) => {
      terminalRef.current = terminal
      if (!terminal) return

      if (!restoredRef.current) {
        restoredRef.current = true
        if (tab.buffer) terminal.write(tab.buffer + RESTORE_NOTE)
      }
      if (pendingRef.current) {
        terminal.write(pendingRef.current)
        pendingRef.current = ''
      }
    },
    [tab.buffer]
  )

  // Publish a buffer serializer so the layout save can persist the screen.
  useEffect(() => {
    registerBuffer(sessionId, () => serializeTerminal(terminalRef.current))
    return () => registerBuffer(sessionId, null)
  }, [sessionId, registerBuffer])

  useEffect(() => {
    onSessionState(sessionId, status.state)
  }, [sessionId, status.state, onSessionState])

  // Remote side closed the shell — the tab drops back to reconnect mode.
  useEffect(() => {
    if ((status.state === 'closed' || status.state === 'error') && everConnectedRef.current) {
      setConnected(false)
    }
  }, [status.state])

  // A tab that was opened for a saved host connects as soon as it is
  // shown. The attempt happens once — a failure is shown in the form.
  const autoConnectRef = useRef(false)
  useEffect(() => {
    if (autoConnectRef.current) return
    if (!tab.hostId) return
    if (tab.buffer.length > 0) return

    autoConnectRef.current = true
    // The attempt waits for the next tick, so the effect itself does not
    // change the state while it runs.
    const timer = setTimeout(() => void connectToHost(), 0)
    return () => clearTimeout(timer)
  }, [connectToHost, tab.buffer.length, tab.hostId])

  const connect = useCallback(
    async (values: ConnectFormValues) => {
      setConnecting(true)
      setError(null)
      try {
        await api.session.connect({
          sessionId,
          protocol: values.protocol,
          host: values.host,
          port: values.port,
          username: values.username,
          authMethod: values.authMethod,
          password: values.authMethod === 'password' ? values.password : undefined,
          keyId: values.keyId
        })
        everConnectedRef.current = true
        setConnected(true)
        setHideRestored(false)
        setProtocol(values.protocol)
        onPatch({
          kind: values.protocol === 'sftp' ? TabKind.SFTP : TabKind.SSH,
          title: `${values.username}@${values.host}`,
          connection: { host: values.host, port: values.port, username: values.username }
        })

        // The password of a saved host is stored encrypted, so it can be
        // exported. A connection made from the ad-hoc form has no host to
        // attach it to — nothing is stored then.
        //
        // The password of the host is stored when the user typed it in
        // the form. When the session opened for a saved host, the
        // password comes from the storage and there is nothing to save.
        if (values.authMethod === 'password' && values.password) {
          const host = await findHostByEndpoint(values.host, values.port, values.username)
          if (host) {
            // A failure here is not swallowed — the user has to know that
            // the password was not stored, otherwise the next connection
            // fails with an error that comes from nowhere.
            const result = await api.hostPassword.saveFromConnect({
              hostId: host.id,
              password: values.password
            })
            if (!result.stored) {
              setError(t('session.errPasswordNotSaved'))
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setConnecting(false)
      }
    },
    [sessionId, onPatch, t]
  )

  const closeSession = useCallback(async () => {
    await disconnect().catch(() => undefined)
    setConnected(false)
  }, [disconnect])

  const initialValues = tab.connection
    ? {
        host: tab.connection.host,
        port: tab.connection.port,
        username: tab.connection.username
      }
    : undefined

  // A file-manager tab has no terminal buffer to restore, so it always
  // shows the connect form until the session is up.
  const showForm = !connected && (isFileManager || hideRestored || !hadRestoredBuffer)
  const showRestored = !connected && hadRestoredBuffer && !hideRestored

  if (showForm) {
    return (
      <div className="terminal-panel terminal-panel--empty">
        <ConnectForm
          onConnect={connect}
          busy={connecting}
          error={error}
          initialValues={initialValues}
          protocol={protocol}
          allowProtocolSwitch={!isFileManager}
          allowAuthSwitch
        />
      </div>
    )
  }

  if (isFileManager) {
    return (
      <div className="terminal-panel">
        <div className="terminal-panel__header">
          <span className="terminal-panel__title">{labelOf(tab)}</span>
          <span
            className={`status-dot status-dot--${status.state === 'connected' ? 'ok' : 'idle'}`}
          />
          <div className="terminal-panel__spacer" />
          <ThemeToggle />
          <button type="button" className="button button--ghost" onClick={closeSession}>
            {t('session.disconnect')}
          </button>
        </div>
        {/*
          The file manager and the drawer of the themes stand in a row —
          the drawer takes a column of its own, the content moves aside.
        */}
        <div className="terminal-panel__body">
          <FileManager sessionId={sessionId} onError={setError} />
          <ThemePanel />
        </div>
      </div>
    )
  }

  return (
    <div className="terminal-panel">
      {connected ? (
        <div className="terminal-panel__header">
          <span className="terminal-panel__title">{labelOf(tab)}</span>
          <span
            className={`status-dot status-dot--${status.state === 'connected' ? 'ok' : 'idle'}`}
          />
          <div className="terminal-panel__spacer" />
          <ThemeToggle />
          <button type="button" className="button button--ghost" onClick={closeSession}>
            {t('session.disconnect')}
          </button>
        </div>
      ) : (
        <div className="reconnect-banner">
          <span>{t('session.notConnected')}</span>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => setHideRestored(true)}
          >
            {t('session.clearScreen')}
          </button>
        </div>
      )}
      {showRestored ? (
        <div className="reconnect-form-wrap">
          <ConnectForm
            onConnect={connect}
            busy={connecting}
            error={error}
            initialValues={initialValues}
            protocol={protocol}
            allowProtocolSwitch
            allowAuthSwitch
          />
        </div>
      ) : null}
      <div className="terminal-panel__body">
        <TerminalView
          sessionId={sessionId}
          onReady={handleReady}
          onInput={(data) => void write(data)}
          onResize={(cols, rows) => void resize(cols, rows)}
        />
        <ThemePanel />
      </div>
    </div>
  )
}

/**
 * Finds the saved host that matches an endpoint.
 *
 * The password can only be attached to a host that is already in the
 * list — a connection made from the ad-hoc form has nothing to attach to.
 */
async function findHostByEndpoint(
  host: string,
  port: number,
  username: string
): Promise<{ id: string } | null> {
  try {
    const hosts = await api.host.list()
    const match = hosts.find(
      (candidate) =>
        candidate.host === host && candidate.port === port && candidate.username === username
    )
    return match ? { id: match.id } : null
  } catch {
    return null
  }
}
