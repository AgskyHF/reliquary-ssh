/**
 * Host form — creates a new connection or edits an existing one.
 *
 * The form is deliberately separate from the connect form: the connect
 * form opens a session, this one saves the connection to the list. The
 * password is stored encrypted, so it can be exported later.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { AuthMethod, ProtocolType, type Host, type KeySummary } from '@shared/types'
import { api } from '../../services/api'
import { useI18n } from '../../i18n/I18nProvider'

export interface HostFormValues {
  name: string
  protocol: ProtocolType
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  keyId: string | null
  notes: string
  /** The password to store — empty means "leave it as it is". */
  password: string
}

export interface HostFormProps {
  /** The host to edit; null creates a new one. */
  host?: Host | null
  /** Called after the host was saved. */
  onSaved?: (host: Host) => void
  /** Called when the user cancels. */
  onCancel?: () => void
}

const DEFAULT_VALUES: HostFormValues = {
  name: '',
  protocol: ProtocolType.SSH,
  host: '',
  port: 22,
  username: '',
  authMethod: AuthMethod.PASSWORD,
  keyId: null,
  notes: '',
  password: ''
}

const PROTOCOLS: { value: ProtocolType; label: string; port: number }[] = [
  { value: ProtocolType.SSH, label: 'SSH', port: 22 },
  { value: ProtocolType.SFTP, label: 'SFTP', port: 22 }
]

export function HostForm({ host, onSaved, onCancel }: HostFormProps) {
  const [values, setValues] = useState<HostFormValues>(() =>
    host
      ? {
          name: host.name,
          protocol: host.protocol,
          host: host.host,
          port: host.port,
          username: host.username,
          authMethod: host.authMethod,
          keyId: host.keyId,
          notes: host.notes,
          password: ''
        }
      : DEFAULT_VALUES
  )
  const [keys, setKeys] = useState<KeySummary[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { t } = useI18n()

  // The key list is only needed for key authentication.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const status = await api.master.status()
        if (!status.unlocked) return

        const list = await api.key.list()
        if (!cancelled) setKeys(list)
      } catch {
        // The keychain is locked — the password method still works.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const update = useCallback((field: keyof HostFormValues, value: string) => {
    setValues((prev) => ({
      ...prev,
      [field]: field === 'port' ? Number(value) || 0 : value
    }))
  }, [])

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!values.name.trim() || !values.host.trim() || !values.username.trim()) {
        setError(t('hostform.errRequired'))
        return
      }
      if (values.authMethod === AuthMethod.KEY && !values.keyId) {
        setError(t('hostform.errNoKey'))
        return
      }

      setBusy(true)
      setError(null)
      try {
        const saved = await api.host.save({
          id: host?.id,
          name: values.name.trim(),
          protocol: values.protocol,
          host: values.host.trim(),
          port: values.port,
          username: values.username.trim(),
          authMethod: values.authMethod,
          keyId: values.authMethod === AuthMethod.KEY ? values.keyId : null,
          notes: values.notes
        })

        // The password is stored encrypted, so it can be exported.
        if (values.password) {
          await api.hostPassword
            .set({ hostId: saved.id, password: values.password })
            .catch(() => undefined)
        }

        onSaved?.(saved)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [host, onSaved, t, values]
  )

  return (
    <form className="host-form" onSubmit={submit}>
      <div className="host-form__title">
        {host ? t('hostform.editTitle') : t('hostform.newTitle')}
      </div>

      <label className="field">
        <span className="field__label">{t('hostform.name')}</span>
        <input
          className="field__input"
          name="hostName"
          type="text"
          value={values.name}
          onChange={(event) => update('name', event.target.value)}
          placeholder="prod"
          autoComplete="off"
        />
      </label>

      <label className="field">
        <span className="field__label">{t('hostform.protocol')}</span>
        <select
          className="field__input"
          name="hostProtocol"
          value={values.protocol}
          onChange={(event) => {
            const protocol = event.target.value as ProtocolType
            const preset = PROTOCOLS.find((item) => item.value === protocol)
            setValues((prev) => ({
              ...prev,
              protocol,
              port: preset?.port ?? prev.port
            }))
          }}
        >
          {PROTOCOLS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field__label">{t('hostform.address')}</span>
        <input
          className="field__input"
          name="hostAddress"
          type="text"
          value={values.host}
          onChange={(event) => update('host', event.target.value)}
          placeholder="example.com"
          spellCheck={false}
          autoComplete="off"
        />
      </label>

      <label className="field">
        <span className="field__label">{t('hostform.port')}</span>
        <input
          className="field__input"
          name="hostPort"
          type="number"
          value={values.port}
          onChange={(event) => update('port', event.target.value)}
        />
      </label>

      <label className="field">
        <span className="field__label">{t('hostform.user')}</span>
        <input
          className="field__input"
          name="hostUsername"
          type="text"
          value={values.username}
          onChange={(event) => update('username', event.target.value)}
          placeholder="root"
          spellCheck={false}
          autoComplete="off"
        />
      </label>

      <label className="field">
        <span className="field__label">{t('hostform.authentication')}</span>
        <select
          className="field__input"
          name="hostAuthMethod"
          value={values.authMethod}
          onChange={(event) =>
            update('authMethod', event.target.value as unknown as string)
          }
        >
          <option value={AuthMethod.PASSWORD}>{t('hostform.authPassword')}</option>
          <option value={AuthMethod.KEY}>{t('hostform.authKey')}</option>
        </select>
      </label>

      {values.authMethod === AuthMethod.KEY ? (
        <label className="field">
          <span className="field__label">{t('hostform.key')}</span>
          <select
            className="field__input"
            name="hostKeyId"
            value={values.keyId ?? ''}
            onChange={(event) => update('keyId', event.target.value)}
          >
            <option value="">{t('hostform.pickKey')}</option>
            {keys.map((key) => (
              <option key={key.id} value={key.id}>
                {key.name} ({key.fingerprint})
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label className="field">
          <span className="field__label">
            {host ? t('hostform.passwordKeep') : t('hostform.passwordOptional')}
          </span>
          <input
            className="field__input"
            name="hostPassword"
            type="password"
            value={values.password}
            onChange={(event) => update('password', event.target.value)}
            autoComplete="new-password"
          />
          <span className="host-form__hint">
            {t('hostform.passwordHint')}
          </span>
        </label>
      )}

      <label className="field">
        <span className="field__label">{t('hostform.notes')}</span>
        <textarea
          className="field__input"
          name="hostNotes"
          value={values.notes}
          onChange={(event) => update('notes', event.target.value)}
          rows={2}
        />
      </label>

      {error ? <div className="connect-form__error">{error}</div> : null}

      <div className="host-form__actions">
        {onCancel ? (
          <button type="button" className="button button--ghost" onClick={onCancel}>
            {t('hostform.cancel')}
          </button>
        ) : null}
        <button
          type="submit"
          className="button button--primary host-form__save"
          disabled={busy}
        >
          {busy ? t('hostform.saving') : host ? t('hostform.save') : t('hostform.add')}
        </button>
      </div>
    </form>
  )
}
