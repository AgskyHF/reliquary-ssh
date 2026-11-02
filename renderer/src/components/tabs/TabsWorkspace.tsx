import { useCallback, useRef, useState } from 'react'
import type { TabPatch } from '@shared/tabs-model'
import { useTabs } from '../../hooks/useTabs'
import type { SessionStatus } from '../../hooks/useSession'
import { TabBar } from './TabBar'
import { SessionTab } from './SessionTab'

/**
 * Main area of stage 3: a TabBar over a stack of always-mounted panes.
 * Inactive panes are hidden, not unmounted — their xterm instance and
 * session subscription stay alive, which is what makes tabs independent.
 */
export function TabsWorkspace() {
  const buffersRef = useRef(new Map<string, () => string>())

  const collectBuffers = useCallback(() => {
    const snapshot = new Map<string, string>()
    for (const [id, getter] of buffersRef.current) snapshot.set(id, getter())
    return snapshot
  }, [])

  const { tabs, activeId, loaded, createNewTab, activate, close, patch, touch } = useTabs({
    collectBuffers
  })

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
