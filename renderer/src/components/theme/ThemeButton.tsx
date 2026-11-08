/**
 * The theme button of a running session.
 *
 * A check mark that slides out of the header on click and opens the
 * catalogue of the themes. The menu can be taken away again with the
 * Escape key or by clicking outside of it.
 */
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { ThemePicker } from '../theme/ThemePicker'

export function ThemeButton() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // A click outside of the menu takes it away.
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="theme-button" ref={rootRef}>
      {open ? (
        <div className="theme-button__menu">
          <div className="theme-button__title">{t('theme.title')}</div>
          <ThemePicker onPicked={() => setOpen(false)} />
        </div>
      ) : null}

      <button
        type="button"
        className={`theme-button__toggle${open ? ' theme-button__toggle--open' : ''}`}
        title={t('theme.change')}
        aria-label={t('theme.change')}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="theme-button__check">✓</span>
      </button>
    </div>
  )
}
