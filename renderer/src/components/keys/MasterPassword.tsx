/**
 * Master-password setup.
 *
 * The master password encrypts the private keys. It is
 * entered once per session and never stored — the derived key lives in the
 * main process memory only.
 */
import { useCallback, useState } from 'react'
import type { MasterStatus } from '@shared/types'
import { api } from '../../services/api'
import { useI18n } from '../../i18n/I18nProvider'

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
  const { t } = useI18n()

  const submit = useCallback(async () => {
    if (password !== confirmation) {
      setError(t('master.errMismatch'))
      return
    }
    if (password.length < 8) {
      setError(t('master.errShort'))
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
  }, [confirmation, onUnlocked, password, t])

  return (
    <div className="master-setup">
      <div className="master-setup__title">{t('master.setupTitle')}</div>
      <p className="master-setup__text">{t('master.setupText')}</p>

      <label className="field">
        <span className="field__label">{t('master.password')}</span>
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
        <span className="field__label">{t('master.repeat')}</span>
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
            {t('master.cancel')}
          </button>
        ) : null}
        <button
          type="button"
          className="button button--primary"
          disabled={busy || !password || !confirmation}
          onClick={() => void submit()}
        >
          {busy ? t('master.setting') : t('master.set')}
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
  const { t } = useI18n()

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
      <div className="master-setup__title">{t('master.unlockTitle')}</div>
      <p className="master-setup__text">{t('master.unlockText')}</p>

      <label className="field">
        <span className="field__label">{t('master.password')}</span>
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
            {t('master.cancel')}
          </button>
        ) : null}
        <button
          type="button"
          className="button button--primary"
          disabled={busy || !password}
          onClick={() => void submit()}
        >
          {busy ? t('master.checking') : t('master.unlock')}
        </button>
      </div>
    </div>
  )
}
