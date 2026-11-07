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

export function TransferPanel() {
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
            setError('Wrong master password')
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
      if (outcome.path) setMessage(`Exported to ${outcome.path}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [includeKeys, includeOld, masterPassword, withPasswords])

  const runImport = useCallback(async () => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const outcome = await api.transfer.import()
      setResult(outcome)
      if (outcome.summary !== 'Cancelled') setMessage(outcome.summary)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [refresh])

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
      setError('The passwords do not match')
      return
    }
    if (masterPassword.length < 8) {
      setError('The master password must be at least 8 characters long')
      return
    }

    setBusy(true)
    setError(null)
    try {
      await api.master.set(masterPassword)
      setMasterPassword('')
      setMasterConfirmation('')
      setNeedsMaster(false)
      setMessage('The master password is set — now pick the export mode and export')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [masterConfirmation, masterPassword])

  return (
    <div className="transfer-panel">
      <div className="transfer-panel__title">Export and import</div>

      {needsMaster ? (
        <div className="transfer-panel__master">
          <div className="master-setup__title">Master password</div>
          <p className="master-setup__text">
            The passwords are sealed with the master password. It never leaves this device and
            cannot be recovered.
          </p>

          <label className="field">
            <span className="field__label">Master password</span>
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
            <span className="field__label">Repeat the password</span>
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
              Cancel
            </button>
            <button
              type="button"
              className="button button--primary transfer-panel__master-set"
              disabled={busy || !masterPassword || !masterConfirmation}
              onClick={() => void createMaster()}
            >
              {busy ? 'Working…' : 'Set the master password'}
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
        <span>With the passwords</span>
      </label>
      <p className="transfer-panel__hint">
        Without the passwords the file carries only the connections and the public keys.
        With them the passwords are sealed with the master password — the file is unreadable
        without it.
      </p>

      <label className="transfer-panel__check">
        <input
          type="checkbox"
          name="includeKeys"
          checked={includeKeys}
          onChange={(event) => setIncludeKeys(event.target.checked)}
        />
        <span>Include the SSH keys</span>
      </label>

      <label className="transfer-panel__check">
        <input
          type="checkbox"
          name="includeOld"
          checked={includeOld}
          onChange={(event) => setIncludeOld(event.target.checked)}
        />
        <span>Include the replaced versions</span>
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
          {busy ? 'Working…' : 'Export…'}
        </button>
        <button
          type="button"
          className="button button--ghost transfer-panel__import"
          disabled={busy}
          onClick={() => void runImport()}
        >
          Import…
        </button>
      </div>

      {result ? (
        <div className="transfer-panel__result">
          Added {result.added}, updated {result.updated}, unchanged {result.unchanged}, moved to
          old {result.superseded}, keys {result.keysAdded}
        </div>
      ) : null}

      <div className="transfer-panel__old">
        <div className="transfer-panel__old-title">
          Replaced versions ({superseded.length})
        </div>
        {superseded.length === 0 ? (
          <div className="sidebar__empty">Nothing yet</div>
        ) : (
          superseded.map((item) => (
            <div key={item.id} className="transfer-panel__old-item">
              <span className="transfer-panel__old-name">{item.name}</span>
              <span className="transfer-panel__old-target">{item.target}</span>
              <span className="transfer-panel__old-time">
                {new Date(item.replacedAt).toLocaleString()}
                {item.hasPassword ? ' · with a password' : ''}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
