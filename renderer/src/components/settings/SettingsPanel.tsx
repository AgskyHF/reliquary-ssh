/**
 * Settings panel — the device settings of the sidebar.
 *
 * The panel owns the sign-in form and the settings that belong to this
 * device: the sync transport (an HTTP backend or a shared folder), the
 * address of the backend, the interface language and the log options.
 */
import { useCallback, useEffect, useState } from 'react'
import type { AppSettings } from '@shared/api'
import { api } from '../../services/api'
import { useI18n } from '../../i18n/I18nProvider'

export interface SettingsPanelProps {
  /** The email of the signed-in account, or null when signed out. */
  signedInAs?: string | null
}

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const

export function SettingsPanel({ signedInAs }: SettingsPanelProps) {
  const { t, language, languages, labelOf, setLanguage } = useI18n()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [serverUrl, setServerUrl] = useState('')
  const [logLevel, setLogLevel] = useState('info')
  const [transport, setTransport] = useState<'server' | 'folder'>('server')
  const [syncFolder, setSyncFolder] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const current = await api.settings.get()
      setSettings(current)
      setServerUrl(current.serverUrl)
      setLogLevel(current.logLevel)
      setTransport(current.syncTransport)
      setSyncFolder(current.syncFolder)
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
      let updated = await api.settings.set({ key: 'syncTransport', value: transport })
      updated = await api.settings.set({ key: 'serverUrl', value: serverUrl })
      updated = await api.settings.set({ key: 'logLevel', value: logLevel })
      if (transport === 'folder') {
        updated = await api.settings.set({ key: 'syncFolder', value: syncFolder })
      }

      setSettings(updated)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [logLevel, serverUrl, syncFolder, transport])

  return (
    <div className="settings-panel">
      <div className="settings-panel__title">{t('settings.title')}</div>

      {signedInAs ? (
        <div className="settings-panel__account">
          {t('settings.signedInAs', { email: signedInAs })}
        </div>
      ) : null}

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
        <span className="field__label">{t('settings.transport')}</span>
        <select
          className="field__input"
          name="syncTransport"
          value={transport}
          onChange={(event) => setTransport(event.target.value as 'server' | 'folder')}
        >
          <option value="server">{t('settings.transportServer')}</option>
          <option value="folder">{t('settings.transportFolder')}</option>
        </select>
      </label>

      {transport === 'server' ? (
        <label className="field">
          <span className="field__label">{t('settings.server')}</span>
          <input
            className="field__input"
            name="serverUrl"
            type="text"
            value={serverUrl}
            onChange={(event) => setServerUrl(event.target.value)}
            placeholder="http://127.0.0.1:8790"
            spellCheck={false}
          />
        </label>
      ) : (
        <label className="field">
          <span className="field__label">{t('settings.folder')}</span>
          <input
            className="field__input"
            name="syncFolder"
            type="text"
            value={syncFolder}
            onChange={(event) => setSyncFolder(event.target.value)}
            placeholder="~/Syncthing/ReliquarySSH"
            spellCheck={false}
          />
          <span className="settings-panel__hint">{t('settings.folderHint')}</span>
        </label>
      )}

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
        disabled={busy || !serverUrl || (transport === 'folder' && !syncFolder)}
        onClick={() => void save()}
      >
        {busy ? t('settings.saving') : t('settings.save')}
      </button>
    </div>
  )
}
