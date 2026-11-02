import { useCallback, useEffect, useRef, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { TabPatch } from '@shared/tabs-model'
import { TabKind, type TabState } from '@shared/types'
import { api } from '../../services/api'
import { useSession, type SessionStatus } from '../../hooks/useSession'
import { TerminalView } from '../TerminalView'
import { ConnectForm, type ConnectFormValues } from '../ConnectForm'
import { FileManager } from '../files/FileManager'

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
          authMethod: 'password',
          password: values.password
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
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setConnecting(false)
      }
    },
    [sessionId, onPatch]
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
        />
      </div>
    )
  }

  if (isFileManager) {
    return (
      <div className="terminal-panel">
        <div className="terminal-panel__header">
          <span className="terminal-panel__title">{tab.title}</span>
          <span
            className={`status-dot status-dot--${status.state === 'connected' ? 'ok' : 'idle'}`}
          />
          <button type="button" className="button button--ghost" onClick={closeSession}>
            Disconnect
          </button>
        </div>
        <FileManager sessionId={sessionId} onError={setError} />
      </div>
    )
  }

  return (
    <div className="terminal-panel">
      {connected ? (
        <div className="terminal-panel__header">
          <span className="terminal-panel__title">{tab.title}</span>
          <span
            className={`status-dot status-dot--${status.state === 'connected' ? 'ok' : 'idle'}`}
          />
          <button type="button" className="button button--ghost" onClick={closeSession}>
            Disconnect
          </button>
        </div>
      ) : (
        <div className="reconnect-banner">
          <span>Session is not connected — reconnect to continue.</span>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => setHideRestored(true)}
          >
            Clear screen
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
          />
        </div>
      ) : null}
      <TerminalView
        sessionId={sessionId}
        onReady={handleReady}
        onInput={(data) => void write(data)}
        onResize={(cols, rows) => void resize(cols, rows)}
      />
    </div>
  )
}
