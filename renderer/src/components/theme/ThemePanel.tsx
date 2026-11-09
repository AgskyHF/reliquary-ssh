/**
 * The theme panel of a running session.
 *
 * The panel slides out on the right and takes a column of its own — the
 * terminal moves aside instead of being covered. It is the same drawer
 * Termius has: the themes live in a column on the right, the terminal
 * keeps the rest of the width.
 */
import { useCallback, useEffect, useRef } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { useTheme } from '../../theme/ThemeProvider'
import { ThemePicker } from '../theme/ThemePicker'

/**
 * The drawer of the themes. It stands next to the terminal and takes a
 * column of its own — the terminal moves aside instead of being covered.
 */
export function ThemePanel() {
  const { t } = useI18n()
  const { drawerOpen, setDrawerOpen } = useTheme()
  const open = drawerOpen
  const setOpen = setDrawerOpen
  const rootRef = useRef<HTMLDivElement | null>(null)

  // The handler of the click outside of the panel.
  const close = useCallback(() => setDrawerOpen(false), [setDrawerOpen])

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

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
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
        <ThemePicker />
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
  const { drawerOpen, setDrawerOpen } = useTheme()

  return (
    <button
      type="button"
      data-theme-toggle="true"
      className={`theme-button__toggle${drawerOpen ? ' theme-button__toggle--open' : ''}`}
      title={t('theme.change')}
      aria-label={t('theme.change')}
      aria-expanded={drawerOpen}
      onClick={() => setDrawerOpen((prev) => !prev)}
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
