/**
 * Tab layout state for the renderer.
 * Loads the saved layout on startup, keeps it in React state,
 * persists it (debounced) on every change and on window unload.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { TabLayoutInput } from '@shared/types'
import {
  activateTab,
  addTab,
  closeTab,
  createTab,
  patchTab,
  withBuffers,
  type TabPatch
} from '@shared/tabs-model'
import { api } from '../services/api'

const SAVE_DEBOUNCE_MS = 800

export interface UseTabsOptions {
  /** Collects the live terminal buffers (tabId -> serialized screen) right before a save. */
  collectBuffers: () => Map<string, string>
}

export function useTabs({ collectBuffers }: UseTabsOptions) {
  const [layout, setLayout] = useState<TabLayoutInput>({ tabs: [], activeTabId: null })
  const [loaded, setLoaded] = useState(false)

  const layoutRef = useRef(layout)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const collectRef = useRef(collectBuffers)

  useEffect(() => {
    collectRef.current = collectBuffers
  }, [collectBuffers])

  const persist = useCallback(async () => {
    try {
      await api.tab.save(withBuffers(layoutRef.current, collectRef.current()))
    } catch {
      // Saving is best-effort — the next change retries.
    }
  }, [])

  const commit = useCallback(
    (next: TabLayoutInput, immediate = false) => {
      layoutRef.current = next
      setLayout(next)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        void persist()
      }, immediate ? 0 : SAVE_DEBOUNCE_MS)
    },
    [persist]
  )

  // Restore the layout saved on the previous run.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const snapshot = await api.tab.load()
      if (cancelled) return

      const tabs = snapshot.tabs.filter((tab) => !tab.deletedAt)
      const first = tabs[0]
      const initial: TabLayoutInput =
        tabs.length === 0
          ? (() => {
              const tab = createTab()
              return { tabs: [tab], activeTabId: tab.id }
            })()
          : {
              tabs,
              activeTabId:
                tabs.some((tab) => tab.id === snapshot.activeTabId)
                  ? snapshot.activeTabId
                  : (first?.id ?? null)
            }

      layoutRef.current = initial
      setLayout(initial)
      setLoaded(true)
    })()

    return () => {
      cancelled = true
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

  // Last-chance save when the window closes.
  useEffect(() => {
    const onUnload = () => {
      void persist()
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [persist])

  // Flush buffers that changed without a layout change (typed output).
  // Unlike commit, touch never resets a pending timer — continuous typing
  // cannot postpone the save forever.
  const touch = useCallback(() => {
    if (timerRef.current) return
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void persist()
    }, SAVE_DEBOUNCE_MS)
  }, [persist])

  const createNewTab = useCallback(() => {
    commit(addTab(layoutRef.current, createTab()))
  }, [commit])

  const activate = useCallback(
    (id: string) => commit(activateTab(layoutRef.current, id), true),
    [commit]
  )

  const close = useCallback(
    async (id: string) => {
      // Closing a tab must tear down its connection, not just its UI.
      await api.session.disconnect(id).catch(() => undefined)
      commit(closeTab(layoutRef.current, id), true)
    },
    [commit]
  )

  const patch = useCallback(
    (id: string, value: TabPatch) => commit(patchTab(layoutRef.current, id, value)),
    [commit]
  )

  return {
    tabs: layout.tabs,
    activeId: layout.activeTabId,
    loaded,
    createNewTab,
    activate,
    close,
    patch,
    touch
  }
}
