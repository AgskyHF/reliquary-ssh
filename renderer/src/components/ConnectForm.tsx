import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

export interface ConnectFormValues {
  host: string
  port: number
  username: string
  password: string
}

export interface ConnectFormProps {
  /** Called with the entered values when the user submits the form. */
  onConnect: (values: ConnectFormValues) => void
  /** Called when the user cancels. */
  onCancel?: () => void
  busy?: boolean
  error?: string | null
}

const DEFAULT_VALUES: ConnectFormValues = {
  host: '127.0.0.1',
  port: 22,
  username: '',
  password: ''
}

/**
 * Connection form. Plain and isolated — all logic stays in the parent component.
 */
export function ConnectForm({ onConnect, onCancel, busy, error }: ConnectFormProps) {
  const [values, setValues] = useState<ConnectFormValues>(DEFAULT_VALUES)
  const [showPassword, setShowPassword] = useState(false)
  const formRef = useRef<HTMLFormElement | null>(null)

  useEffect(() => {
    formRef.current?.querySelector<HTMLInputElement>('input[name="host"]')?.focus()
  }, [])

  const update = useCallback(
    (field: keyof ConnectFormValues, value: string) => {
      setValues((prev) => ({
        ...prev,
        [field]: field === 'port' ? Number(value) || 0 : value
      }))
    },
    []
  )

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!values.host || !values.username) return
      onConnect(values)
    },
    [onConnect, values]
  )

  return (
    <form className="connect-form" ref={formRef} onSubmit={submit}>
      <div className="connect-form__title">New SSH connection</div>

      <label className="field">
        <span className="field__label">Host</span>
        <input
          className="field__input"
          name="host"
          value={values.host}
          onChange={(event) => update('host', event.target.value)}
          placeholder="example.com or 10.0.0.5"
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      <label className="field">
        <span className="field__label">Port</span>
        <input
          className="field__input"
          name="port"
          type="number"
          min={1}
          max={65535}
          value={values.port}
          onChange={(event) => update('port', event.target.value)}
        />
      </label>

      <label className="field">
        <span className="field__label">Username</span>
        <input
          className="field__input"
          name="username"
          value={values.username}
          onChange={(event) => update('username', event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      <label className="field">
        <span className="field__label">Password</span>
        <span className="field__row">
          <input
            className="field__input"
            name="password"
            type={showPassword ? 'text' : 'password'}
            value={values.password}
            onChange={(event) => update('password', event.target.value)}
            autoComplete="off"
          />
          <button
            type="button"
            className="field__toggle"
            onClick={() => setShowPassword((prev) => !prev)}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </span>
      </label>

      {error ? <div className="connect-form__error">{error}</div> : null}

      <div className="connect-form__actions">
        {onCancel ? (
          <button type="button" className="button button--ghost" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        <button type="submit" className="button button--primary" disabled={busy}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </div>
    </form>
  )
}
