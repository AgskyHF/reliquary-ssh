/**
 * Settings panel — the device settings of the sidebar.
 *
 * The panel owns the settings that belong to this device: the interface
 * language and the log options. The connections themselves live in the
 * Hosts section, and the sync happens through a file — see the Sync
 * section.
 */
import { useCallback, useEffect, useState } from 'react'
import type { AppSettings } from '@shared/api'
import { api } from '../../services/api'
import { useI18n } from '../../i18n/I18nProvider'

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const

export function SettingsPanel() {
  const { t, language, languages, labelOf, setLanguage } = useI18n()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [logLevel, setLogLevel] = useState('info')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const current = await api.settings.get()
      setSettings(current)
      setLogLevel(current.logLevel)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await Promise.resolve()
      if (!cancelled) await refresh()
    })()
    return () => {
      cancelled = true
    }
  }, [refresh])

  const save = useCallback(async () => {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const updated = await api.settings.set({ key: 'logLevel', value: logLevel })
      setSettings(updated)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [logLevel])

  return (
    <div className="settings-panel">
      <div className="settings-panel__title">{t('settings.title')}</div>

      <label className="field">
        <span className="field__label">{t('settings.language')}</span>
        <select
          className="field__input"
          name="language"
          value={language}
          onChange={(event) => {
            void setLanguage(event.target.value as typeof language)
          }}
        >
          {languages.map((item) => (
            <option key={item} value={item}>
              {labelOf(item)}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field__label">{t('settings.logLevel')}</span>
        <select
          className="field__input"
          name="logLevel"
          value={logLevel}
          onChange={(event) => setLogLevel(event.target.value)}
        >
          {LOG_LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </label>

      {settings?.logPath ? (
        <div className="settings-panel__hint">
          {t('settings.logFile', { path: settings.logPath })}
        </div>
      ) : null}

      {error ? <div className="connect-form__error">{error}</div> : null}
      {saved ? <div className="settings-panel__saved">{t('settings.saved')}</div> : null}

      <button
        type="button"
        className="button button--primary settings-panel__save"
        disabled={busy}
        onClick={() => void save()}
      >
        {busy ? t('settings.saving') : t('settings.save')}
      </button>
    </div>
  )
}
