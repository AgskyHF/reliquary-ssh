/**
 * Settings panel — the device settings of the sidebar.
 *
 * The panel owns the sign-in form and the settings that belong to this
 * device: the address of the sync backend and the log options.
 */
import { useCallback, useEffect, useState } from 'react'
import type { AppSettings } from '@shared/api'
import { api } from '../../services/api'

export interface SettingsPanelProps {
  /** The email of the signed-in account, or null when signed out. */
  signedInAs?: string | null
}

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const

export function SettingsPanel({ signedInAs }: SettingsPanelProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [serverUrl, setServerUrl] = useState('')
  const [logLevel, setLogLevel] = useState('info')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const current = await api.settings.get()
      setSettings(current)
      setServerUrl(current.serverUrl)
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
      const updated = await api.settings.set({ key: 'serverUrl', value: serverUrl })
      await api.settings.set({ key: 'logLevel', value: logLevel })
      setSettings(updated)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [logLevel, serverUrl])

  return (
    <div className="settings-panel">
      <div className="settings-panel__title">Settings</div>

      {signedInAs ? (
        <div className="settings-panel__account">Signed in as {signedInAs}</div>
      ) : null}

      <label className="field">
        <span className="field__label">Sync server</span>
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

      <label className="field">
        <span className="field__label">Log level</span>
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
        <div className="settings-panel__hint">Log file: {settings.logPath}</div>
      ) : null}

      {error ? <div className="connect-form__error">{error}</div> : null}
      {saved ? <div className="settings-panel__saved">Saved</div> : null}

      <button
        type="button"
        className="button button--primary settings-panel__save"
        disabled={busy || !serverUrl}
        onClick={() => void save()}
      >
        {busy ? 'Saving…' : 'Save settings'}
      </button>
    </div>
  )
}
