/**
 * Pure tab-layout logic shared by the renderer (state) and tests.
 * No DOM, no Electron — everything here is a plain function over TabLayoutInput.
 */
import { TabKind } from './types'
import type { ConnectionTarget, TabLayoutInput, TabState } from './types'

export const NEW_TAB_TITLE = 'New connection'

/** Upper bound for a persisted terminal buffer; the tail is kept. */
export const MAX_BUFFER_CHARS = 200_000

const newId = (): string => crypto.randomUUID()
const nowIso = (): string => new Date().toISOString()

export interface NewTabOptions {
  kind?: TabKind
  title?: string
  connection?: ConnectionTarget | null
  /** The saved host the tab opens for. */
  hostId?: string | null
}

export function createTab(options: NewTabOptions = {}): TabState {
  const ts = nowIso()
  return {
    id: newId(),
    kind: options.kind ?? TabKind.SSH,
    title: options.title ?? NEW_TAB_TITLE,
    hostId: options.hostId ?? null,
    connection: options.connection ?? null,
    buffer: '',
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
    version: 1,
    deviceId: ''
  }
}

export function addTab(layout: TabLayoutInput, tab: TabState): TabLayoutInput {
  return { tabs: [...layout.tabs, tab], activeTabId: tab.id }
}

export function activateTab(layout: TabLayoutInput, id: string): TabLayoutInput {
  if (!layout.tabs.some((tab) => tab.id === id)) return layout
  return { ...layout, activeTabId: id }
}

/**
 * Removes a tab and picks the next active one (right neighbour, else left).
 * Closing the last tab leaves a fresh blank tab behind — the app always has one.
 */
export function closeTab(layout: TabLayoutInput, id: string): TabLayoutInput {
  const index = layout.tabs.findIndex((tab) => tab.id === id)
  if (index === -1) return layout

  const tabs = layout.tabs.filter((tab) => tab.id !== id)
  if (tabs.length === 0) {
    const replacement = createTab()
    return { tabs: [replacement], activeTabId: replacement.id }
  }

  let activeTabId = layout.activeTabId
  if (layout.activeTabId === id) {
    const fallback = tabs[Math.min(index, tabs.length - 1)]
    activeTabId = fallback?.id ?? null
  }
  return { tabs, activeTabId }
}

export type TabPatch = Partial<
  Pick<TabState, 'title' | 'buffer' | 'connection' | 'kind' | 'hostId'>
>

export function patchTab(
  layout: TabLayoutInput,
  id: string,
  patch: TabPatch
): TabLayoutInput {
  return {
    ...layout,
    tabs: layout.tabs.map((tab) =>
      tab.id === id
        ? { ...tab, ...patch, updatedAt: nowIso(), version: tab.version + 1 }
        : tab
    )
  }
}

/** Applies live terminal buffers to the layout before it is saved. */
export function withBuffers(
  layout: TabLayoutInput,
  buffers: Map<string, string>
): TabLayoutInput {
  return {
    ...layout,
    tabs: layout.tabs.map((tab) =>
      buffers.has(tab.id) ? { ...tab, buffer: capBuffer(buffers.get(tab.id) ?? '') } : tab
    )
  }
}

export function capBuffer(text: string): string {
  return text.length <= MAX_BUFFER_CHARS ? text : text.slice(text.length - MAX_BUFFER_CHARS)
}
