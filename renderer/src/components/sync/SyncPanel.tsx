/**
 * Sync panel — the screen of the sidebar that carries the data between
 * the devices.
 *
 * There is no server and no account: the user exports one file here and
 * imports it on the other device. The file holds encrypted blobs only —
 * without the master password it says nothing.
 *
 * The panel walks the user through the three states:
 *  - no master password yet: create one;
 *  - the master password is locked: unlock it;
 *  - unlocked: the counters and the two buttons.
 */
import { useCallback, useEffect, useState } from 'react'
import type { SyncResult, SyncStatus } from '@shared/sync'
import { api } from '../../services/api'
import { useI18n } from '../../i18n/I18nProvider'
import { MasterPasswordSetup, MasterPasswordUnlock } from '../keys/MasterPassword'

export function SyncPanel() {
  const { t } = useI18n()
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [result, setResult] = useState<SyncResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.sync.status())
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

  /** Writes the sync file — the native save dialog is shown. */
  const exportFile = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const outcome = await api.sync.exportFile()
      if (outcome.path) {
        setResult({
          exported: outcome.exported,
          imported: 0,
          applied: 0,
          skipped: 0,
          conflicts: 0,
          undecryptable: 0,
          syncedAt: new Date().toISOString()
        })
      }
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [refresh])

  /** Reads the sync file — the native open dialog is shown. */
  const importFile = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const outcome = await api.sync.importFile()
      if (outcome.imported > 0) setResult(outcome)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const unlocked = useCallback(async (): Promise<void> => {
    await refresh()
  }, [refresh])

  if (!status) {
    return <div className="sidebar__empty">{t('sync.loading')}</div>
  }

  if (!status.configured) {
    return (
      <div className="sync-panel">
        <MasterPasswordSetup onUnlocked={() => void unlocked()} />
        {error ? <div className="sync-panel__error">{error}</div> : null}
      </div>
    )
  }

  if (!status.unlocked) {
    return (
      <div className="sync-panel">
        <MasterPasswordUnlock onUnlocked={() => void unlocked()} />
        {error ? <div className="sync-panel__error">{error}</div> : null}
      </div>
    )
  }

  return (
    <div className="sync-panel">
      <div className="sync-panel__title">{t('nav.sync')}</div>

      <p className="sync-panel__lead">{t('sync.lead')}</p>

      <div className="sync-panel__row">
        <span className="sync-panel__label">{t('sync.pending')}</span>
        <span className="sync-panel__value sync-panel__pending">{status.pending}</span>
      </div>
      <div className="sync-panel__row">
        <span className="sync-panel__label">{t('sync.replicas')}</span>
        <span className="sync-panel__value">{status.replicas}</span>
      </div>
      <div className="sync-panel__row">
        <span className="sync-panel__label">{t('sync.lastSync')}</span>
        <span className="sync-panel__value">
          {status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleTimeString() : t('sync.never')}
        </span>
      </div>

      {result ? (
        <div className="sync-panel__result" data-synced-at={result.syncedAt}>
          {t('sync.result', {
            exported: result.exported,
            imported: result.imported,
            applied: result.applied
          })}
        </div>
      ) : null}

      {status.lastError ? <div className="sync-panel__error">{status.lastError}</div> : null}
      {error ? <div className="sync-panel__error">{error}</div> : null}

      <div className="sync-panel__actions">
        <button
          type="button"
          className="button button--primary sync-panel__export"
          disabled={busy}
          onClick={() => void exportFile()}
        >
          {busy ? t('sync.working') : t('sync.export')}
        </button>
        <button
          type="button"
          className="button button--ghost sync-panel__import"
          disabled={busy}
          onClick={() => void importFile()}
        >
          {t('sync.import')}
        </button>
      </div>

      <p className="sync-panel__hint">{t('sync.hint')}</p>
    </div>
  )
}
