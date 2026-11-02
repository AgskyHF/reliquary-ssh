import { useCallback, useEffect, useRef, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import { api } from '../services/api'
import { useSession } from '../hooks/useSession'
import { TerminalView } from './TerminalView'
import { ConnectForm, type ConnectFormValues } from './ConnectForm'

interface ActiveSession {
  sessionId: string
  title: string
}

const SESSION_ID = 'session-1'

export function TerminalPanel() {
  const [active, setActive] = useState<ActiveSession | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(true)

  const terminalRef = useRef<Terminal | null>(null)
  const bufferRef = useRef<string>('')

  // Output that arrives before the terminal is mounted is buffered and replayed.
  const handleData = useCallback((chunk: string) => {
    if (terminalRef.current) {
      terminalRef.current.write(chunk)
    } else {
      bufferRef.current += chunk
    }
  }, [])

  const { status, write, resize } = useSession({
    sessionId: active?.sessionId ?? SESSION_ID,
    onData: handleData
  })

  const handleReady = useCallback((terminal: Terminal | null) => {
    terminalRef.current = terminal
    if (terminal && bufferRef.current) {
      terminal.write(bufferRef.current)
      bufferRef.current = ''
    }
  }, [])

  const connect = useCallback(async (values: ConnectFormValues) => {
    setConnecting(true)
    setConnectError(null)

    try {
      await api.session.connect({
        sessionId: SESSION_ID,
        host: values.host,
        port: values.port,
        username: values.username,
        authMethod: 'password',
        password: values.password
      })

      setActive({ sessionId: SESSION_ID, title: `${values.username}@${values.host}` })
      setShowForm(false)
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : String(error))
    } finally {
      setConnecting(false)
    }
  }, [])

  const disconnect = useCallback(async () => {
    if (!active) return
    await api.session.disconnect(active.sessionId)
    setActive(null)
    setShowForm(true)
  }, [active])

  // Close the connection when the component unmounts.
  useEffect(() => {
    return () => {
      void api.session.disconnect(SESSION_ID).catch(() => undefined)
    }
  }, [])

  if (!active) {
    return (
      <div className="terminal-panel terminal-panel--empty">
        {showForm ? (
          <ConnectForm onConnect={connect} busy={connecting} error={connectError} />
        ) : null}
      </div>
    )
  }

  return (
    <div className="terminal-panel">
      <div className="terminal-panel__header">
        <span className="terminal-panel__title">{active.title}</span>
        <span className={`status-dot status-dot--${status.state === 'connected' ? 'ok' : 'idle'}`} />
        <button type="button" className="button button--ghost" onClick={disconnect}>
          Disconnect
        </button>
      </div>
      <TerminalView
        sessionId={active.sessionId}
        onReady={handleReady}
        onInput={(data) => void write(data)}
        onResize={(cols, rows) => void resize(cols, rows)}
      />
    </div>
  )
}
