/**
 * Sync panel — the E2EE sync screen of the sidebar.
 *
 * It walks the user through the three states of the engine:
 *  - signed out: sync needs an account;
 *  - signed in without a master password on this device: create one, or
 *    adopt the one the account already has (the salt comes from the server);
 *  - signed in with a locked master password: unlock it.
 * Once unlocked the panel shows the counters and runs a sync on demand.
 */
import { useCallback, useEffect, useState } from 'react'
import type { SyncResult, SyncStatusView } from '@shared/sync'
import type { MasterStatus } from '@shared/types'
import { api } from '../../services/api'
import { MasterPasswordSetup, MasterPasswordUnlock } from '../keys/MasterPassword'

/** The auto-sync intervals the panel offers, in seconds. */
const AUTO_SYNC_OPTIONS = [
  { value: 0, label: 'Off — sync only on demand' },
  { value: 60, label: 'Every minute' },
  { value: 300, label: 'Every 5 minutes' },
  { value: 900, label: 'Every 15 minutes' },
  { value: 3600, label: 'Every hour' }
]

export function SyncPanel() {
  const [status, setStatus] = useState<SyncStatusView | null>(null)
  const [result, setResult] = useState<SyncResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoSyncSeconds, setAutoSyncSeconds] = useState(300)

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.sync.status())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  /** Writes the interval; the main process re-arms its timer. */
  const saveAutoSync = useCallback(async (seconds: number): Promise<void> => {
    try {
      const settings = await api.settings.set({
        key: 'autoSyncSeconds',
        value: String(seconds)
      })
      setAutoSyncSeconds(settings.autoSyncSeconds)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  // The interval is a device setting, so the panel reads it on open.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const settings = await api.settings.get()
        if (!cancelled) setAutoSyncSeconds(settings.autoSyncSeconds)
      } catch {
        // The panel still works with the default interval.
      }
    })()

    return () => {
      cancelled = true
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

  /**
   * The pending counter has to follow the local changes, which are made
   * in other panels — the panel polls the state instead of waiting for an
   * event that would have to be broadcast from every writer.
   */
  useEffect(() => {
    const timer = setInterval(() => {
      void refresh()
    }, 2000)

    return () => {
      clearInterval(timer)
    }
  }, [refresh])

  const runSync = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      setResult(await api.sync.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      await refresh()
    }
  }, [refresh])

  const unlocked = useCallback(
    (_status: MasterStatus) => {
      void (async () => {
        await refresh()
        await runSync()
      })()
    },
    [refresh, runSync]
  )

  if (!status) {
    return <div className="sidebar__empty">Loading…</div>
  }

  if (!status.signedIn) {
    return (
      <div className="sync-panel">
        <div className="sync-panel__title">Sync</div>
        <div className="sidebar__empty">
          Sign in on the Settings tab to sync your hosts and keys.
        </div>
      </div>
    )
  }

  if (!status.configured) {
    return (
      <div className="sync-panel">
        {status.remoteKdf ? (
          <AccountMasterPassword onUnlocked={unlocked} />
        ) : (
          <MasterPasswordSetup onUnlocked={unlocked} />
        )}
        {error ? <div className="sync-panel__error">{error}</div> : null}
      </div>
    )
  }

  if (!status.unlocked) {
    return (
      <div className="sync-panel">
        <MasterPasswordUnlock onUnlocked={unlocked} />
        {error ? <div className="sync-panel__error">{error}</div> : null}
      </div>
    )
  }

  return (
    <div className="sync-panel">
      <div className="sync-panel__title">Sync</div>

      <div className="sync-panel__row">
        <span className="sync-panel__label">Pending changes</span>
        <span className="sync-panel__value sync-panel__pending">{status.pending}</span>
      </div>
      <div className="sync-panel__row">
        <span className="sync-panel__label">Last sync</span>
        <span className="sync-panel__value">
          {status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleTimeString() : 'Never'}
        </span>
      </div>

      <label className="field">
        <span className="field__label">Auto sync</span>
        <select
          className="field__input"
          name="autoSyncSeconds"
          value={autoSyncSeconds}
          onChange={(event) => {
            const value = Number(event.target.value)
            setAutoSyncSeconds(value)
            void saveAutoSync(value)
          }}
        >
          {AUTO_SYNC_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="settings-panel__hint">
          The sync also runs when the app starts and when you unlock the master password.
        </span>
      </label>

      {result ? (
        <div className="sync-panel__result" data-synced-at={result.syncedAt}>
          Pushed {result.pushed}, applied {result.applied}
          {result.conflicts > 0 ? `, conflicts ${result.conflicts}` : ''}
        </div>
      ) : null}

      {status.lastError ? <div className="sync-panel__error">{status.lastError}</div> : null}
      {error ? <div className="sync-panel__error">{error}</div> : null}

      <button
        type="button"
        className="button button--primary sync-panel__now"
        disabled={busy}
        onClick={() => void runSync()}
      >
        {busy ? 'Syncing…' : 'Sync now'}
      </button>

      <div className="sync-panel__server">{status.serverUrl}</div>
    </div>
  )
}

/**
 * Sets the master password of an account that already has one.
 *
 * The salt lives with the account, so the same password derives the same
 * key here and the synced data becomes readable.
 */
function AccountMasterPassword({ onUnlocked }: { onUnlocked: (status: MasterStatus) => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const status = await api.master.setFromAccount(password)
      setPassword('')
      onUnlocked(status)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [onUnlocked, password])

  return (
    <div className="master-setup">
      <div className="master-setup__title">Master password</div>
      <p className="master-setup__text">
        This account already has a master password. Enter it to read your synced hosts and keys
        on this device.
      </p>

      <label className="field">
        <span className="field__label">Master password</span>
        <input
          className="field__input"
          name="accountMasterPassword"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
        />
      </label>

      {error ? <div className="connect-form__error">{error}</div> : null}

      <div className="master-setup__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={busy || !password}
          onClick={() => void submit()}
        >
          {busy ? 'Checking…' : 'Unlock this device'}
        </button>
      </div>
    </div>
  )
}
