/**
 * The theme picker.
 *
 * The catalogue of the terminal themes, the way Termius shows it: a small
 * preview of the terminal on the left, the name of the theme on the right.
 * The preview is drawn from the palette of the theme itself, so it always
 * shows the colours the terminal will really have.
 */
import { useCallback } from 'react'
import { useTheme } from '../../theme/ThemeProvider'
import type { TerminalTheme } from '@shared/themes'

export interface ThemePickerProps {
  /** Called after the theme was picked — the panel closes itself. */
  onPicked?: (theme: TerminalTheme) => void
}

/** A small drawing of a terminal in the colours of the theme. */
function ThemePreview({ theme }: { theme: TerminalTheme }) {
  const { colors } = theme

  return (
    <svg className="theme-picker__preview" viewBox="0 0 120 74" aria-hidden="true">
      <rect width="120" height="74" rx="7" fill={colors.background} />
      <rect
        x="0.5"
        y="0.5"
        width="119"
        height="73"
        rx="6.5"
        fill="none"
        stroke={colors.green}
        strokeWidth="1"
        opacity="0.55"
      />

      {/* The bar of the window with the three buttons. */}
      <rect x="0" y="0" width="120" height="11" rx="7" fill={colors.black} opacity="0.6" />
      <circle cx="9" cy="6" r="2" fill={colors.red} />
      <circle cx="17" cy="6" r="2" fill={colors.yellow} />
      <circle cx="25" cy="6" r="2" fill={colors.green} />

      {/* The lines of the session. */}
      <rect x="9" y="22" width="26" height="4" rx="2" fill={colors.green} />
      <rect x="9" y="32" width="54" height="4" rx="2" fill={colors.white} opacity="0.75" />
      <rect x="9" y="42" width="38" height="4" rx="2" fill={colors.blue} opacity="0.85" />
      <rect x="9" y="52" width="46" height="4" rx="2" fill={colors.white} opacity="0.5" />
      <rect x="9" y="62" width="18" height="4" rx="2" fill={colors.magenta} opacity="0.8" />
    </svg>
  )
}

export function ThemePicker({ onPicked }: ThemePickerProps) {
  const { themes, themeId, setThemeId } = useTheme()

  const pick = useCallback(
    (id: string) => {
      void setThemeId(id)
      onPicked?.(themes.find((theme) => theme.id === id) ?? themes[0])
    },
    [onPicked, setThemeId, themes]
  )

  return (
    <div className="theme-picker" role="radiogroup" aria-label="Terminal theme">
      {themes.map((theme) => {
        const active = theme.id === themeId

        return (
          <button
            key={theme.id}
            type="button"
            role="radio"
            aria-checked={active}
            className={`theme-picker__item${active ? ' theme-picker__item--active' : ''}`}
            onClick={() => pick(theme.id)}
          >
            <ThemePreview theme={theme} />
            <span className="theme-picker__text">
              <span className="theme-picker__name">{theme.name}</span>
              {theme.hint ? <span className="theme-picker__hint">{theme.hint}</span> : null}
            </span>
            {active ? <span className="theme-picker__check">✓</span> : null}
          </button>
        )
      })}
    </div>
  )
}
