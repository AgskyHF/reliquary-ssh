import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { KeySummary } from '@shared/types'
import { api } from '../services/api'
import { useI18n } from '../i18n/I18nProvider'

export interface ConnectFormValues {
  /**
   * The name of the connection in the list of the hosts. It is empty by
   * default — the name is made from the user and the address, and the
   * user can give his own.
   */
  name: string
  host: string
  port: number
  username: string
  password: string
  /** Protocol the user picked in the form (SSH when the switch is hidden). */
  protocol: ConnectProtocol
  /** Authentication method: password or a key from the Keychain. */
  authMethod: 'password' | 'key'
  /** The Keychain key id, when authMethod is 'key'. */
  keyId: string | null
  /** A free note about the host — it travels with the export. */
  notes: string
}

export type ConnectProtocol = 'ssh' | 'sftp'

export interface ConnectFormProps {
  /** Called with the entered values when the user submits the form. */
  onConnect: (values: ConnectFormValues) => void
  /**
   * Called when the user wants to save the connection to the list of
   * the hosts. The button "Add" shows next to "Connect".
   */
  onSave?: (values: ConnectFormValues) => void
  /** Called when the user cancels. */
  onCancel?: () => void
  /** Pre-fills host/port/username (e.g. reconnecting a restored tab). */
  initialValues?: Partial<ConnectFormValues>
  /** Protocol the form connects with; SSH when omitted. */
  protocol?: ConnectProtocol
  /** Shows the SSH/SFTP switch. */
  allowProtocolSwitch?: boolean
  /** Shows the password / key switch. */
  allowAuthSwitch?: boolean
  busy?: boolean
  error?: string | null
  /** The name of the host that was just added to the list. */
  notice?: string | null
  /**
   * Grows when the fields have to be cleared — after the connection was
   * added to the list, for example.
   */
  resetSignal?: number
}

const DEFAULT_VALUES: ConnectFormValues = {
  name: '',
  host: '',
  port: 22,
  username: '',
  password: '',
  protocol: 'ssh',
  authMethod: 'password',
  keyId: null,
  notes: ''
}

/**
 * Connection form. Plain and isolated — all logic stays in the parent component.
 */
export function ConnectForm({
  onConnect,
  onSave,
  onCancel,
  initialValues,
  protocol = 'ssh',
  allowProtocolSwitch = false,
  allowAuthSwitch = false,
  busy,
  error,
  notice,
  resetSignal
}: ConnectFormProps) {
  const [values, setValues] = useState<ConnectFormValues>(() => ({
    ...DEFAULT_VALUES,
    ...initialValues
  }))
  const [selectedProtocol, setSelectedProtocol] = useState<ConnectProtocol>(protocol)
  const [authMethod, setAuthMethod] = useState<'password' | 'key'>(
    initialValues?.authMethod ?? 'password'
  )
  const [showPassword, setShowPassword] = useState(false)
  const [keys, setKeys] = useState<KeySummary[]>([])
  const [keyId, setKeyId] = useState<string | null>(initialValues?.keyId ?? null)
  const formRef = useRef<HTMLFormElement | null>(null)
  const { t } = useI18n()

  useEffect(() => {
    formRef.current?.querySelector<HTMLInputElement>('input[name="host"]')?.focus()
  }, [])

  // The fields are cleared when the connection was added to the list.
  useEffect(() => {
    if (resetSignal === undefined) return

    // The clearing waits for the next tick, so the effect itself does not
    // change the state while it runs.
    const timer = setTimeout(() => {
      setValues((prev) => ({
        ...prev,
        name: '',
        host: '',
        username: '',
        password: '',
        notes: ''
      }))
      setKeyId(null)
      setShowPassword(false)
    }, 0)
    return () => clearTimeout(timer)
  }, [resetSignal])

  // The key list is needed only when key authentication is available.
  useEffect(() => {
    if (!allowAuthSwitch) return

    let cancelled = false
    void (async () => {
      try {
        // The keys need no master password — they are sealed with the
        // key of the device.
        const list = await api.key.list()
        if (!cancelled) setKeys(list)
      } catch {
        // The keys are unavailable — the password method still works,
        // so this is not an error.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [allowAuthSwitch])

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
      if (authMethod === 'key' && !keyId) return
      onConnect({
        ...values,
        protocol: selectedProtocol,
        authMethod,
        keyId: authMethod === 'key' ? keyId : null
      })
    },
    [authMethod, keyId, onConnect, selectedProtocol, values]
  )

  return (
    <form className="connect-form" ref={formRef} onSubmit={submit}>
      <div className="connect-form__title">{t('connect.title')}</div>

      {allowProtocolSwitch ? (
        <div className="protocol-switch" role="radiogroup" aria-label={t('connect.protocol')}>
          {(['ssh', 'sftp'] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="radio"
              aria-checked={selectedProtocol === item}
              className={`protocol-switch__option${
                selectedProtocol === item ? ' protocol-switch__option--active' : ''
              }`}
              onClick={() => setSelectedProtocol(item)}
            >
              {item.toUpperCase()}
            </button>
          ))}
        </div>
      ) : null}

      {allowAuthSwitch ? (
        <div className="protocol-switch" role="radiogroup" aria-label={t('connect.authentication')}>
          <button
            type="button"
            role="radio"
            aria-checked={authMethod === 'password'}
            className={`protocol-switch__option${
              authMethod === 'password' ? ' protocol-switch__option--active' : ''
            }`}
            onClick={() => setAuthMethod('password')}
          >
            {t('connect.methodPassword')}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={authMethod === 'key'}
            className={`protocol-switch__option${
              authMethod === 'key' ? ' protocol-switch__option--active' : ''
            }`}
            onClick={() => setAuthMethod('key')}
          >
            {t('connect.methodKey')}
          </button>
        </div>
      ) : null}

      <label className="field">
        <span className="field__label">{t('connect.name')}</span>
        <input
          className="field__input"
          name="connectionName"
          type="text"
          value={values.name}
          onChange={(event) => update('name', event.target.value)}
          placeholder={t('connect.namePlaceholder')}
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      <label className="field">
        <span className="field__label">{t('connect.host')}</span>
        <input
          className="field__input"
          name="host"
          value={values.host}
          onChange={(event) => update('host', event.target.value)}
          placeholder={t('connect.hostPlaceholder')}
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      <label className="field">
        <span className="field__label">{t('connect.port')}</span>
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
        <span className="field__label">{t('connect.username')}</span>
        <input
          className="field__input"
          name="username"
          value={values.username}
          onChange={(event) => update('username', event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      {authMethod === 'key' ? (
        <label className="field">
          <span className="field__label">{t('connect.key')}</span>
          <select
            className="field__input"
            name="key"
            value={keyId ?? ''}
            onChange={(event) => setKeyId(event.target.value || null)}
          >
            <option value="">
              {keys.length === 0 ? t('connect.noKeys') : t('connect.selectKey')}
            </option>
            {keys.map((key) => (
              <option key={key.id} value={key.id}>
                {key.name} ({key.type})
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label className="field">
          <span className="field__label">{t('connect.password')}</span>
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
              {showPassword ? t('connect.hide') : t('connect.show')}
            </button>
          </span>
        </label>
      )}

      {error ? <div className="connect-form__error">{error}</div> : null}
      {notice ? (
        <div className="connect-form__notice">
          <span className="connect-form__notice-mark" aria-hidden="true">
            ✓
          </span>
          {notice}
        </div>
      ) : null}

      <label className="field">
        <span className="field__label">{t('connect.notes')}</span>
        <textarea
          className="field__input"
          name="connectionNotes"
          value={values.notes}
          onChange={(event) => update('notes', event.target.value)}
          rows={2}
        />
      </label>

      <div className="connect-form__actions">
        {onCancel ? (
          <button type="button" className="button button--ghost" onClick={onCancel}>
            {t('connect.cancel')}
          </button>
        ) : null}

        {/*
          "Add" puts the connection into the list of the hosts on the
          left, "Connect" opens the session with it.
        */}
        {onSave ? (
          <button
            type="button"
            className="button button--ghost"
            disabled={busy || !values.host || !values.username}
            onClick={() => onSave(values)}
          >
            {t('connect.add')}
          </button>
        ) : null}

        <button
          type="submit"
          className="button button--primary"
          disabled={busy || (authMethod === 'key' && !keyId)}
        >
          {busy ? t('connect.connecting') : t('connect.connect')}
        </button>
      </div>
    </form>
  )
}
