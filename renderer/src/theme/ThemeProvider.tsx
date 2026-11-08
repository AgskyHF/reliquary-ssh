/**
 * The theme provider.
 *
 * The theme of the terminal is a device setting: it is read on startup and
 * written back when the user picks another one. The terminal subscribes
 * to it, so a change shows up in the open sessions right away.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../services/api'
import {
  DEFAULT_THEME_ID,
  TERMINAL_THEMES,
  isThemeId,
  themeById,
  type TerminalTheme
} from '@shared/themes'

export interface ThemeContextValue {
  /** The id of the current theme. */
  themeId: string
  /** The current theme. */
  theme: TerminalTheme
  /** Every theme of the catalogue. */
  themes: TerminalTheme[]
  /** Picks a theme and stores it as a device setting. */
  setThemeId: (id: string) => Promise<void>
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeIdState] = useState<string>(DEFAULT_THEME_ID)

  // The stored theme is applied once, when the app starts.
  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const settings = await api.settings.get()
        if (!cancelled && isThemeId(settings.terminalTheme)) {
          setThemeIdState(settings.terminalTheme)
        }
      } catch {
        // The settings are not reachable — the default theme is fine.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const setThemeId = useCallback(async (id: string) => {
    setThemeIdState(id)
    try {
      await api.settings.set({ key: 'terminalTheme', value: id })
    } catch {
      // The setting could not be stored — the theme still applies to this
      // session, so the UI is not broken by it.
    }
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({
      themeId,
      theme: themeById(themeId),
      themes: TERMINAL_THEMES,
      setThemeId
    }),
    [setThemeId, themeId]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

/** The current theme and the catalogue. */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside a ThemeProvider')
  return context
}
