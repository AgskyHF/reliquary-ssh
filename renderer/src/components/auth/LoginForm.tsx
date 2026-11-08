/**
 * Sign-in screen.
 *
 * Two ways to sign in, as the plan requires: Google (OAuth 2.0 with PKCE)
 * and email + password.
 */
import { useCallback, useState } from 'react'
import { auth } from '../../services/auth'
import { useI18n } from '../../i18n/I18nProvider'

export interface LoginFormProps {
  /** Called after a successful sign-in. */
  onSignedIn?: (email: string) => void
}

type Mode = 'login' | 'register'

export function LoginForm({ onSignedIn }: LoginFormProps) {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { t } = useI18n()

  const submit = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const session =
        mode === 'login'
          ? await auth.login(email, password)
          : await auth.register(email, password)

      setPassword('')
      onSignedIn?.(session.user.email)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [email, mode, onSignedIn, password])

  const signInWithGoogle = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const session = await auth.loginWithGoogle()
      onSignedIn?.(session.user.email)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [onSignedIn])

  return (
    <div className="login-form">
      <div className="login-form__title">
        {mode === 'login' ? t('login.signInTitle') : t('login.registerTitle')}
      </div>

      <button
        type="button"
        className="button button--primary login-form__google"
        disabled={busy}
        onClick={() => void signInWithGoogle()}
      >
        {t('login.google')}
      </button>

      <div className="login-form__separator">{t('login.or')}</div>

      <label className="field">
        <span className="field__label">{t('login.email')}</span>
        <input
          className="field__input"
          name="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          spellCheck={false}
        />
      </label>

      <label className="field">
        <span className="field__label">{t('login.password')}</span>
        <input
          className="field__input"
          name="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={mode === 'register' ? t('login.passwordHint') : ''}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        />
      </label>

      {error ? <div className="connect-form__error">{error}</div> : null}

      <div className="login-form__actions">
        <button
          type="button"
          className="button button--ghost"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login')
            setError(null)
          }}
        >
          {mode === 'login' ? t('login.createAccount') : t('login.haveAccount')}
        </button>
        <button
          type="button"
          className="button button--primary"
          disabled={busy || !email || !password}
          onClick={() => void submit()}
        >
          {busy ? t('login.wait') : mode === 'login' ? t('login.signIn') : t('login.create')}
        </button>
      </div>
    </div>
  )
}
