import { useCallback, useEffect, useRef, useState } from 'react'
import type { TabPatch } from '@shared/tabs-model'
import { TabKind } from '@shared/types'
import { useTabs } from '../../hooks/useTabs'
import type { SessionStatus } from '../../hooks/useSession'
import { TabBar } from './TabBar'
import { SessionTab } from './SessionTab'

/**
 * Main area of stage 3: a TabBar over a stack of always-mounted panes.
 * Inactive panes are hidden, not unmounted — their xterm instance and
 * session subscription stay alive, which is what makes tabs independent.
 */
export interface TabsWorkspaceProps {
  /** The host the sidebar picked — a tab is opened for it. */
  pendingHost?: {
    id: string
    host: string
    port: number
    username: string
    protocol: TabKind
  } | null
  /** Called when the host was opened — the pending one is cleared. */
  onHostOpened?: () => void
}

export function TabsWorkspace({ pendingHost, onHostOpened }: TabsWorkspaceProps) {
  const buffersRef = useRef(new Map<string, () => string>())

  const collectBuffers = useCallback(() => {
    const snapshot = new Map<string, string>()
    for (const [id, getter] of buffersRef.current) snapshot.set(id, getter())
    return snapshot
  }, [])

  const { tabs, activeId, loaded, createNewTab, openHostTab, activate, close, patch, touch } =
    useTabs({
      collectBuffers
    })

  // The host from the sidebar opens in a tab of its own.
  useEffect(() => {
    if (!pendingHost) return
    openHostTab(
      {
        id: pendingHost.id,
        host: pendingHost.host,
        port: pendingHost.port,
        username: pendingHost.username
      },
      pendingHost.protocol
    )
    onHostOpened?.()
  }, [onHostOpened, openHostTab, pendingHost])

  const [states, setStates] = useState<Record<string, SessionStatus['state']>>({})

  const registerBuffer = useCallback((id: string, getter: (() => string) | null) => {
    if (getter) buffersRef.current.set(id, getter)
    else buffersRef.current.delete(id)
  }, [])

  const handleSessionState = useCallback((id: string, state: SessionStatus['state']) => {
    setStates((prev) => (prev[id] === state ? prev : { ...prev, [id]: state }))
  }, [])

  const handleClose = useCallback(
    (id: string) => {
      buffersRef.current.delete(id)
      setStates((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      void close(id)
    },
    [close]
  )

  if (!loaded) return null

  return (
    <div className="main-area">
      <div className="main-area__tabs">
        <TabBar
          tabs={tabs}
          activeId={activeId}
          states={states}
          onSelect={activate}
          onClose={handleClose}
          onCreate={createNewTab}
        />
      </div>
      <div className="main-area__content">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="tab-pane"
            data-tab-id={tab.id}
            hidden={tab.id !== activeId}
          >
            <SessionTab
              tab={tab}
              onPatch={(value: TabPatch) => patch(tab.id, value)}
              onSessionState={handleSessionState}
              registerBuffer={registerBuffer}
              onActivity={touch}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
