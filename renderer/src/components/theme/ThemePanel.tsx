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
      className={`theme-button__toggle${drawerOpen ? ' theme-button__toggle--open' : ''}`}
      title={t('theme.change')}
      aria-label={t('theme.change')}
      aria-expanded={drawerOpen}
      onClick={() => setDrawerOpen(!drawerOpen)}
    >
      <span className="theme-button__check">✓</span>
    </button>
  )
}
