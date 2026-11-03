/**
 * Master-password setup.
 *
 * The master password encrypts the private keys and the synced data. It is
 * entered once per session and never stored — the derived key lives in the
 * main process memory only.
 */
import { useCallback, useState } from 'react'
import type { MasterStatus } from '@shared/types'
import { api } from '../../services/api'

export interface MasterPasswordSetupProps {
  /** Called when the master password was set or the app was unlocked. */
  onUnlocked?: (status: MasterStatus) => void
  /** Called when the user cancels the setup. */
  onCancel?: () => void
}

export function MasterPasswordSetup({ onUnlocked, onCancel }: MasterPasswordSetupProps) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(async () => {
    if (password !== confirmation) {
      setError('The passwords do not match')
      return
    }
    if (password.length < 8) {
      setError('The master password must be at least 8 characters long')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const status = await api.master.set(password)
      setPassword('')
      setConfirmation('')
      onUnlocked?.(status)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [confirmation, onUnlocked, password])

  return (
    <div className="master-setup">
      <div className="master-setup__title">Master password</div>
      <p className="master-setup__text">
        The master password encrypts your private keys and the data you sync. It never leaves
        this device and cannot be recovered.
      </p>

      <label className="field">
        <span className="field__label">Master password</span>
        <input
          className="field__input"
          name="masterPassword"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
        />
      </label>

      <label className="field">
        <span className="field__label">Repeat the password</span>
        <input
          className="field__input"
          name="masterPasswordConfirm"
          type="password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="new-password"
        />
      </label>

      {error ? <div className="connect-form__error">{error}</div> : null}

      <div className="master-setup__actions">
        {onCancel ? (
          <button type="button" className="button button--ghost" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          className="button button--primary"
          disabled={busy || !password || !confirmation}
          onClick={() => void submit()}
        >
          {busy ? 'Setting…' : 'Set master password'}
        </button>
      </div>
    </div>
  )
}

/**
 * Unlocks the keychain with an existing master password.
 */
export function MasterPasswordUnlock({
  onUnlocked,
  onCancel
}: {
  onUnlocked?: (status: MasterStatus) => void
  onCancel?: () => void
}) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const status = await api.master.unlock(password)
      setPassword('')
      onUnlocked?.(status)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [onUnlocked, password])

  return (
    <div className="master-setup">
      <div className="master-setup__title">Unlock the keychain</div>
      <p className="master-setup__text">Enter your master password to use the stored keys.</p>

      <label className="field">
        <span className="field__label">Master password</span>
        <input
          className="field__input"
          name="masterPassword"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
        />
      </label>

      {error ? <div className="connect-form__error">{error}</div> : null}

      <div className="master-setup__actions">
        {onCancel ? (
          <button type="button" className="button button--ghost" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          className="button button--primary"
          disabled={busy || !password}
          onClick={() => void submit()}
        >
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </div>
    </div>
  )
}
