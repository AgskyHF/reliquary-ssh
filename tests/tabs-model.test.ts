import { describe, expect, it } from 'vitest'
import {
  addTab,
  capBuffer,
  closeTab,
  createTab,
  MAX_BUFFER_CHARS,
  patchTab,
  withBuffers
} from '@shared/tabs-model'
import type { TabLayoutInput } from '@shared/types'

describe('tabs model', () => {
  it('createTab produces a full TabState', () => {
    const tab = createTab()
    expect(tab.id).toMatch(/-/u)
    expect(tab.kind).toBe('ssh')
    expect(tab.title).toBe('New connection')
    expect(tab.version).toBe(1)
    expect(tab.deletedAt).toBeNull()
    expect(tab.connection).toBeNull()
  })

  it('addTab appends and activates the new tab', () => {
    const first = createTab()
    const second = createTab()
    const layout = addTab({ tabs: [first], activeTabId: first.id }, second)
    expect(layout.tabs.map((t) => t.id)).toEqual([first.id, second.id])
    expect(layout.activeTabId).toBe(second.id)
  })

  it('closing the active tab activates the right neighbour', () => {
    const a = createTab()
    const b = createTab()
    const c = createTab()
    const layout: TabLayoutInput = { tabs: [a, b, c], activeTabId: b.id }
    const next = closeTab(layout, b.id)
    expect(next.tabs.map((t) => t.id)).toEqual([a.id, c.id])
    expect(next.activeTabId).toBe(c.id)
  })

  it('closing the last tab of three keeps an active tab', () => {
    const a = createTab()
    const b = createTab()
    const c = createTab()
    const layout: TabLayoutInput = { tabs: [a, b, c], activeTabId: c.id }
    const next = closeTab(layout, c.id)
    expect(next.activeTabId).toBe(b.id)
  })

  it('closing a non-active tab keeps the active one', () => {
    const a = createTab()
    const b = createTab()
    const layout: TabLayoutInput = { tabs: [a, b], activeTabId: a.id }
    const next = closeTab(layout, b.id)
    expect(next.activeTabId).toBe(a.id)
  })

  it('closing the only tab leaves a fresh blank tab', () => {
    const a = createTab()
    const next = closeTab({ tabs: [a], activeTabId: a.id }, a.id)
    expect(next.tabs).toHaveLength(1)
    expect(next.tabs[0]?.id).not.toBe(a.id)
    expect(next.activeTabId).toBe(next.tabs[0]?.id)
  })

  it('patchTab bumps version and updatedAt only on the target tab', () => {
    const a = createTab()
    const b = createTab()
    const layout: TabLayoutInput = { tabs: [a, b], activeTabId: a.id }
    const next = patchTab(layout, a.id, { title: 'tester@host' })
    expect(next.tabs[0]?.title).toBe('tester@host')
    expect(next.tabs[0]?.version).toBe(2)
    expect(next.tabs[1]?.version).toBe(1)
  })

  it('withBuffers applies live screens and caps their size', () => {
    const a = createTab()
    const layout: TabLayoutInput = { tabs: [a], activeTabId: a.id }
    const huge = 'x'.repeat(MAX_BUFFER_CHARS + 100)
    const next = withBuffers(layout, new Map([[a.id, huge]]))
    expect(next.tabs[0]?.buffer.length).toBe(MAX_BUFFER_CHARS)
    expect(next.tabs[0]?.buffer.endsWith('x')).toBe(true)
  })

  it('capBuffer keeps short strings untouched', () => {
    expect(capBuffer('short')).toBe('short')
  })
})
