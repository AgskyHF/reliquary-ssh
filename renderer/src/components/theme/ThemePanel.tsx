/**
 * The theme panel of a running session.
 *
 * The panel slides out on the right and takes a column of its own — the
 * terminal moves aside instead of being covered. It is the same drawer
 * Termius has: the themes live in a column on the right, the terminal
 * keeps the rest of the width.
 *
 * The state of the drawer belongs to the tab, not to the app: every tab
 * has a drawer of its own, and only the one on the screen is open. A
 * shared flag opened the drawer in every tab at once, and the drawer of a
 * hidden tab took the click that picks a theme as a click outside of
 * itself — the theme was never applied.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { ThemePicker } from '../theme/ThemePicker'

interface DrawerContextValue {
  /** True while the drawer of this tab is out. */
  open: boolean
  /** Slides the drawer of this tab in or out. */
  setOpen: (open: boolean | ((prev: boolean) => boolean)) => void
}

const DrawerContext = createContext<DrawerContextValue | null>(null)

/**
 * Holds the state of the drawer of one tab.
 *
 * The button in the header and the drawer next to the terminal have to
 * agree with each other, and nothing else — hence the provider.
 */
export function ThemeDrawerProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(false)

  const setOpen = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    setOpenState((prev) => (typeof next === 'function' ? next(prev) : next))
  }, [])

  const value = useMemo<DrawerContextValue>(() => ({ open, setOpen }), [open, setOpen])

  return <DrawerContext.Provider value={value}>{children}</DrawerContext.Provider>
}

/** The state of the drawer of the tab. */
function useDrawer(): DrawerContextValue {
  const context = useContext(DrawerContext)
  if (!context) {
    throw new Error('The theme drawer must be used inside a ThemeDrawerProvider')
  }
  return context
}

/**
 * The drawer of the themes. It stands next to the terminal and takes a
 * column of its own — the terminal moves aside instead of being covered.
 */
export function ThemePanel() {
  const { t } = useI18n()
  const { open, setOpen } = useDrawer()
  const rootRef = useRef<HTMLDivElement | null>(null)

  // The handler of the click outside of the panel.
  const close = useCallback(() => setOpen(false), [setOpen])

  // A click outside of the panel takes it away.
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null

      /*
       * The button that opens the drawer stands in the header, while the
       * drawer stands next to the terminal — it is not inside the panel.
       * Without this the click on the button would count as a click
       * outside: the panel would close and the button would open it
       * again right away.
       */
      if (target?.closest?.('[data-theme-toggle]')) return

      if (!rootRef.current?.contains(event.target as Node)) close()
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [close, open])

  return (
    <aside
      className={`theme-panel${open ? ' theme-panel--open' : ''}`}
      ref={rootRef}
      aria-hidden={!open}
    >
      <div className="theme-panel__head">
        <span className="theme-panel__title">{t('theme.title')}</span>
        <button
          type="button"
          className="theme-panel__close"
          title={t('theme.close')}
          aria-label={t('theme.close')}
          onClick={() => setOpen(false)}
        >
          ✕
        </button>
      </div>
      <div className="theme-panel__body">
        <ThemePicker onPicked={() => setOpen(false)} />
      </div>
    </aside>
  )
}

/**
 * The button in the header of a session. The check mark slides out of
 * it when the drawer opens.
 */
export function ThemeToggle() {
  const { t } = useI18n()
  const { open, setOpen } = useDrawer()

  return (
    <button
      type="button"
      data-theme-toggle="true"
      className={`theme-button__toggle${open ? ' theme-button__toggle--open' : ''}`}
      title={t('theme.change')}
      aria-label={t('theme.change')}
      aria-expanded={open}
      onClick={() => setOpen((prev) => !prev)}
    >
      {/*
        The check mark slides out of the button when the drawer opens.
        While the drawer is closed the button shows a palette — an empty
        square would look like a broken button.
      */}
      <span className="theme-button__palette" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 3a9 9 0 0 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.2 0-1.1.9-2 2-2h1.5A4.5 4.5 0 0 0 21 10c0-3.9-4-7-9-7z" />
          <circle cx="7.5" cy="11" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="10.5" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      </span>
      <span className="theme-button__check">✓</span>
    </button>
  )
}
