/**
 * Hook that owns one terminal session in the renderer.
 * It subscribes to the main-process events for a session id and exposes
 * the data/state/error stream to the component.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../services/api'

export interface SessionStatus {
  state: 'idle' | 'connecting' | 'connected' | 'closing' | 'closed' | 'error'
  error: string | null
}

export interface UseSessionOptions {
  sessionId: string
  /** Called with every chunk of remote output. */
  onData: (chunk: string) => void
}

export function useSession({ sessionId, onData }: UseSessionOptions) {
  const [status, setStatus] = useState<SessionStatus>({ state: 'idle', error: null })
  const dataRef = useRef(onData)

  // Keep the callback current without touching the ref during render.
  useEffect(() => {
    dataRef.current = onData
  }, [onData])

  useEffect(() => {
    const offData = api.session.onData((payload) => {
      if (payload.sessionId === sessionId) dataRef.current(payload.chunk)
    })

    const offState = api.session.onState((payload) => {
      if (payload.sessionId !== sessionId) return
      setStatus((prev) => ({ ...prev, state: payload.state as SessionStatus['state'] }))
    })

    const offError = api.session.onError((payload) => {
      if (payload.sessionId !== sessionId) return
      setStatus((prev) => ({ ...prev, state: 'error', error: payload.message }))
    })

    return () => {
      offData()
      offState()
      offError()
    }
  }, [sessionId])

  const write = useCallback(
    async (data: string) => {
      await api.session.write({ sessionId, data })
    },
    [sessionId]
  )

  const resize = useCallback(
    async (cols: number, rows: number) => {
      await api.session.resize({ sessionId, cols, rows })
    },
    [sessionId]
  )

  const disconnect = useCallback(async () => {
    await api.session.disconnect(sessionId)
  }, [sessionId])

  return { status, write, resize, disconnect }
}
