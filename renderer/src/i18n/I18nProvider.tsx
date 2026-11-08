/**
 * The i18n provider.
 *
 * The language is a device setting: it is read from the settings on start
 * and written back when the user picks another one. The whole UI reads the
 * strings through `useI18n()` — no component holds a hardcoded text.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../services/api'
import {
  DICTIONARIES,
  LANGUAGE_LABELS,
  LANGUAGES,
  type Language,
  type TranslationKey
} from './dictionaries'

export interface I18nContextValue {
  /** The current language. */
  language: Language
  /** The languages the user can pick. */
  languages: readonly Language[]
  /** The label of a language, in that language. */
  labelOf: (language: Language) => string
  /** Translates a key; the placeholders are filled from `values`. */
  t: (key: TranslationKey, values?: Record<string, string | number>) => string
  /** Changes the language and stores it as a device setting. */
  setLanguage: (language: Language) => Promise<void>
}

const I18nContext = createContext<I18nContextValue | null>(null)

/** Reads the language that was stored on this device. */
async function readStoredLanguage(): Promise<Language> {
  try {
    const settings = await api.settings.get()
    return isLanguage(settings.language) ? settings.language : 'en'
  } catch {
    // The settings are not reachable — English is a safe default.
    return 'en'
  }
}

/** Narrows an unknown value to a known language. */
export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value)
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('en')

  // The stored language is applied once, when the app starts.
  useEffect(() => {
    let cancelled = false

    void (async () => {
      const stored = await readStoredLanguage()
      if (!cancelled) setLanguageState(stored)
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const setLanguage = useCallback(async (next: Language) => {
    setLanguageState(next)
    try {
      await api.settings.set({ key: 'language', value: next })
    } catch {
      // The setting could not be stored — the language still applies to
      // this session, so the UI is not broken by it.
    }
  }, [])

  const t = useCallback(
    (key: TranslationKey, values?: Record<string, string | number>): string => {
      const template = DICTIONARIES[language][key] ?? DICTIONARIES.en[key] ?? key
      if (!values) return template

      return template.replace(/\{(\w+)\}/gu, (match, name: string) => {
        const value = values[name]
        return value === undefined ? match : String(value)
      })
    },
    [language]
  )

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      languages: LANGUAGES,
      labelOf: (item) => LANGUAGE_LABELS[item],
      t,
      setLanguage
    }),
    [language, setLanguage, t]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

/** The translation function of the current language. */
export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used inside an I18nProvider')
  return context
}
