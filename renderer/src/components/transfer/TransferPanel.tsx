/**
 * Transfer panel — the export and import screen of the sidebar.
 *
 * The export offers one choice: with the passwords or without them.
 * There is no password of its own — the archive is made the moment the
 * button is pressed. Without the option it carries the connections and
 * the public keys; with it the passwords of the hosts go along, and they
 * come back on any device that imports the file.
 *
 * The panel also lists the versions that lost a merge — the "old" folder.
 * They are never deleted, because the old password may still be needed.
 */
import { useCallback, useEffect, useState } from 'react'
import type { SupersededSummary } from '@shared/api'
import type { ImportResult } from '@shared/export'
import { api } from '../../services/api'
import { useI18n } from '../../i18n/I18nProvider'

/** The date of a version — the day, the time and the seconds. */
function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

export function TransferPanel({ onHostsChanged }: { onHostsChanged?: () => void }) {
  const [withPasswords, setWithPasswords] = useState(false)
  const [includeKeys, setIncludeKeys] = useState(true)
  const [includeOld, setIncludeOld] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [superseded, setSuperseded] = useState<SupersededSummary[]>([])
  const { t } = useI18n()

  const refresh = useCallback(async () => {
    try {
      setSuperseded(await api.transfer.superseded())
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
   * The old folder changes outside the panel — an import adds versions.
   * The panel polls the state instead of waiting for an event that every
   * writer would have to send.
   */
  useEffect(() => {
    const timer = setInterval(() => {
      void refresh()
    }, 2000)

    return () => {
      clearInterval(timer)
    }
  }, [refresh])

  const runExport = useCallback(async () => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const outcome = await api.transfer.export({
        options: {
          mode: withPasswords ? 'with-passwords' : 'without-passwords',
          includeKeys,
          includeOld
        }
      })
      if (outcome.path) {
        if (outcome.unreadable > 0) {
          // A password sealed with another key cannot be read here — the
          // user has to know it did not make it into the file.
          setError(t('transfer.errUnreadable', { count: outcome.unreadable }))
        } else if (withPasswords) {
          setMessage(t('transfer.exportedWith', { path: outcome.path, count: outcome.passwords }))
        } else {
          setMessage(t('transfer.exported', { path: outcome.path }))
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [includeKeys, includeOld, t, withPasswords])

  /** Brings a replaced version back — with its password when it can be read. */
  const restore = useCallback(
    async (id: string) => {
      setBusy(true)
      setError(null)
      setMessage(null)
      try {
        const outcome = await api.transfer.restore({ id })
        setMessage(outcome.summary)
        // The host changed — the list has to show it.
        onHostsChanged?.()
        await refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [onHostsChanged, refresh]
  )

  /** Removes a version from the old folder for good. */
  const forget = useCallback(
    async (id: string) => {
      try {
        await api.transfer.forget({ id })
        await refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [refresh]
  )

  /** Empties the old folder — one click instead of one click per version. */
  const forgetAll = useCallback(async () => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const outcome = await api.transfer.forgetAll()
      setMessage(t('transfer.forgetAllDone', { count: outcome.removed }))
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [refresh, t])

  const runImport = useCallback(async () => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const outcome = await api.transfer.import()
      setResult(outcome)
      if (outcome.summary !== 'Cancelled') setMessage(outcome.summary)
      // The import changed the hosts — the list has to show them.
      if (outcome.added > 0 || outcome.updated > 0) onHostsChanged?.()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [onHostsChanged, refresh])

  return (
    <div className="transfer-panel">
      <div className="transfer-panel__title">{t('transfer.title')}</div>

      <label className="transfer-panel__check">
        <input
          type="checkbox"
          name="withPasswords"
          checked={withPasswords}
          onChange={(event) => setWithPasswords(event.target.checked)}
        />
        <span>{t('transfer.withPasswords')}</span>
      </label>
      <p className="transfer-panel__hint">{t('transfer.withPasswordsHint')}</p>

      <label className="transfer-panel__check">
        <input
          type="checkbox"
          name="includeKeys"
          checked={includeKeys}
          onChange={(event) => setIncludeKeys(event.target.checked)}
        />
        <span>{t('transfer.includeKeys')}</span>
      </label>

      <label className="transfer-panel__check">
        <input
          type="checkbox"
          name="includeOld"
          checked={includeOld}
          onChange={(event) => setIncludeOld(event.target.checked)}
        />
        <span>{t('transfer.includeOld')}</span>
      </label>

      {error ? <div className="connect-form__error">{error}</div> : null}
      {message ? <div className="transfer-panel__message">{message}</div> : null}

      <div className="transfer-panel__actions">
        <button
          type="button"
          className="button button--primary transfer-panel__export"
          disabled={busy}
          onClick={() => void runExport()}
        >
          {busy ? t('transfer.working') : t('transfer.export')}
        </button>
        <button
          type="button"
          className="button button--ghost transfer-panel__import"
          disabled={busy}
          onClick={() => void runImport()}
        >
          {t('transfer.import')}
        </button>
      </div>

      {result ? (
        <div className="transfer-panel__result">
          {t('transfer.result', {
            added: result.added,
            updated: result.updated,
            unchanged: result.unchanged,
            superseded: result.superseded,
            keys: result.keysAdded,
            passwords: result.passwords
          })}
        </div>
      ) : null}

      <div className="transfer-panel__old">
        <div className="transfer-panel__old-title">
          <span>{t('transfer.oldTitle', { count: superseded.length })}</span>
          {superseded.length > 0 ? (
            <button
              type="button"
              className="button button--ghost transfer-panel__forget-all"
              disabled={busy}
              onClick={() => void forgetAll()}
            >
              {t('transfer.forgetAll')}
            </button>
          ) : null}
        </div>
        {superseded.length === 0 ? (
          <div className="sidebar__empty">{t('transfer.oldEmpty')}</div>
        ) : (
          superseded.map((item) => (
            <div key={item.id} className="transfer-panel__old-item">
              <div className="transfer-panel__old-version">
                <span className="transfer-panel__old-tag">
                  {t('transfer.oldVersionTag')}
                </span>
                <span className="transfer-panel__old-name">{item.name}</span>
                <span className="transfer-panel__old-target">{item.target}</span>
                <span className="transfer-panel__old-time">
                  {formatDate(item.updatedAt)}
                  {item.hasPassword ? t('transfer.withPasswordTag') : ''}
                </span>
              </div>

              <div className="transfer-panel__old-version">
                <span className="transfer-panel__old-tag transfer-panel__old-tag--current">
                  {t('transfer.currentVersionTag')}
                </span>
                <span className="transfer-panel__old-name">
                  {item.currentName || t('transfer.currentGone')}
                </span>
                {item.currentTarget ? (
                  <span className="transfer-panel__old-target">{item.currentTarget}</span>
                ) : null}
                {item.currentUpdatedAt ? (
                  <span className="transfer-panel__old-time">
                    {formatDate(item.currentUpdatedAt)}
                  </span>
                ) : null}
              </div>

              <div className="transfer-panel__old-actions">
                <button
                  type="button"
                  className="button button--ghost transfer-panel__restore"
                  disabled={busy}
                  onClick={() => void restore(item.id)}
                >
                  {t('transfer.restore')}
                </button>
                <button
                  type="button"
                  className="button button--ghost transfer-panel__forget"
                  disabled={busy}
                  onClick={() => void forget(item.id)}
                >
                  {t('transfer.forget')}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
