/**
 * Transfer panel — the export and import screen of the sidebar.
 *
 * The export offers the choice the user asked for: with the passwords or
 * without them. A sealed export needs an unlocked master password; a plain
 * one works always and carries no secrets at all.
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
  // The master password has to be created or entered before a sealed
  // export — it does not depend on the sync being set up.
  const [needsMaster, setNeedsMaster] = useState(false)
  const [masterPassword, setMasterPassword] = useState('')
  const [masterConfirmation, setMasterConfirmation] = useState('')
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
   * The old folder changes outside the panel — an import adds versions,
   * a sync brings them from another device. The panel polls the state
   * instead of waiting for an event that every writer would have to send.
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
      // A sealed export needs an unlocked master password. The panel
      // asks for it when it is missing — the export must not depend on
      // the sync being set up.
      if (withPasswords) {
        const status = await api.master.status()
        if (!status.configured) {
          setNeedsMaster(true)
          return
        }
        if (!status.unlocked) {
          const ok = await api.master.verify(masterPassword)
          if (!ok) {
            setError(t('transfer.errWrongMaster'))
            return
          }
        }
      }

      const outcome = await api.transfer.export({
        options: {
          mode: withPasswords ? 'sealed' : 'plain',
          includeKeys,
          includeOld
        }
      })
      if (outcome.path) setMessage(t('transfer.exported', { path: outcome.path }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [includeKeys, includeOld, masterPassword, t, withPasswords])

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

  /**
   * The sealed export needs an unlocked master password.
   *
   * The requirement is shown as soon as the option is picked — the user
   * must not hit the button and only then learn that a master password
   * is missing.
   */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      await Promise.resolve()
      if (cancelled || !withPasswords) return

      try {
        const status = await api.master.status()
        if (!cancelled && !status.configured) setNeedsMaster(true)
      } catch {
        // The status is not known — the export will report the problem.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [withPasswords])

  /** Creates the master password, then the export can continue. */
  const createMaster = useCallback(async () => {
    if (masterPassword !== masterConfirmation) {
      setError(t('master.errMismatch'))
      return
    }
    if (masterPassword.length < 8) {
      setError(t('master.errShort'))
      return
    }

    setBusy(true)
    setError(null)
    try {
      await api.master.set(masterPassword)
      setMasterPassword('')
      setMasterConfirmation('')
      setNeedsMaster(false)
      setMessage(t('transfer.masterReady'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [masterConfirmation, masterPassword, t])

  return (
    <div className="transfer-panel">
      <div className="transfer-panel__title">{t('transfer.title')}</div>

      {needsMaster ? (
        <div className="transfer-panel__master">
          <div className="master-setup__title">{t('master.setupTitle')}</div>
          <p className="master-setup__text">{t('transfer.sealedText')}</p>

          <label className="field">
            <span className="field__label">{t('master.password')}</span>
            <input
              className="field__input"
              name="exportMasterPassword"
              type="password"
              value={masterPassword}
              onChange={(event) => setMasterPassword(event.target.value)}
              autoComplete="new-password"
            />
          </label>

          <label className="field">
            <span className="field__label">{t('master.repeat')}</span>
            <input
              className="field__input"
              name="exportMasterPasswordConfirm"
              type="password"
              value={masterConfirmation}
              onChange={(event) => setMasterConfirmation(event.target.value)}
              autoComplete="new-password"
            />
          </label>

          {error ? <div className="connect-form__error">{error}</div> : null}

          <div className="master-setup__actions">
            <button
              type="button"
              className="button button--ghost"
              onClick={() => {
                setNeedsMaster(false)
                setError(null)
              }}
            >
              {t('master.cancel')}
            </button>
            <button
              type="button"
              className="button button--primary transfer-panel__master-set"
              disabled={busy || !masterPassword || !masterConfirmation}
              onClick={() => void createMaster()}
            >
              {busy ? t('transfer.working') : t('transfer.masterSet')}
            </button>
          </div>
        </div>
      ) : null}

      <label className="transfer-panel__check">
        <input
          type="checkbox"
          name="withPasswords"
          checked={withPasswords}
          onChange={(event) => {
            setWithPasswords(event.target.checked)
            if (!event.target.checked) setNeedsMaster(false)
          }}
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
            keys: result.keysAdded
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
