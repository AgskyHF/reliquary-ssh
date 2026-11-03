/**
 * Keychain panel — the SSH key manager.
 *
 * Shows the stored keys and offers generation, import, export and deletion.
 * The private key never reaches the renderer: only the public key, the
 * fingerprint and the metadata are shown.
 */
import { useCallback, useEffect, useState } from 'react'
import { KeyType, type KeySummary } from '@shared/types'
import { api } from '../../services/api'
import { MasterPasswordSetup, MasterPasswordUnlock } from './MasterPassword'

export interface KeychainPanelProps {
  /** Called when the key list changed, so the host form can refresh. */
  onKeysChanged?: () => void
}

type Dialog = 'none' | 'generate' | 'import'

const KEY_TYPE_LABELS: Record<KeyType, string> = {
  [KeyType.RSA]: 'RSA',
  [KeyType.ED25519]: 'Ed25519',
  [KeyType.ECDSA]: 'ECDSA'
}

/** Formats an ISO timestamp as a short local date. */
function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString()
}

export function KeychainPanel({ onKeysChanged }: KeychainPanelProps) {
  const [keys, setKeys] = useState<KeySummary[]>([])
  const [unlocked, setUnlocked] = useState<boolean | null>(null)
  const [configured, setConfigured] = useState(false)
  const [dialog, setDialog] = useState<Dialog>('none')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  // Generation form state.
  const [name, setName] = useState('')
  const [type, setType] = useState<string>('ed25519')
  const [comment, setComment] = useState('')
  const [passphrase, setPassphrase] = useState('')
  // Import form state.
  const [privateKey, setPrivateKey] = useState('')
  const [importPassphrase, setImportPassphrase] = useState('')

  const refresh = useCallback(async () => {
    try {
      const status = await api.master.status()
      setUnlocked(status.unlocked)
      setConfigured(status.configured)

      // The key list is only available while the keychain is unlocked.
      setKeys(status.unlocked ? await api.key.list() : [])
      onKeysChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [onKeysChanged])

  // The key list is loaded when the panel mounts. The load is deferred into
  // a microtask so the effect body itself never sets state.
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

  const generate = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const key = await api.key.generate({ name, type, comment, passphrase })
      setDialog('none')
      setName('')
      setComment('')
      setPassphrase('')
      setNotice(`Key "${key.name}" created`)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [comment, name, passphrase, refresh, type])

  const importKey = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const key = await api.key.import({
        name,
        privateKey,
        passphrase: importPassphrase
      })
      setDialog('none')
      setName('')
      setPrivateKey('')
      setImportPassphrase('')
      setNotice(`Key "${key.name}" imported`)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [importPassphrase, name, privateKey, refresh])

  const remove = useCallback(
    async (id: string) => {
      setBusy(true)
      setError(null)
      try {
        await api.key.remove(id)
        await refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [refresh]
  )

  const exportPublic = useCallback(async (key: KeySummary) => {
    setError(null)
    try {
      const publicKey = await api.key.exportPublic(key.id)
      await navigator.clipboard.writeText(publicKey)
      setNotice(`Public key of "${key.name}" copied to the clipboard`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  if (unlocked === false) {
    return (
      <div className="keychain-panel">
        {configured ? (
          <MasterPasswordUnlock onUnlocked={() => void refresh()} />
        ) : (
          <MasterPasswordSetup onUnlocked={() => void refresh()} />
        )}
      </div>
    )
  }

  return (
    <div className="keychain-panel">
      <div className="keychain-panel__toolbar">
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            setDialog('generate')
            setError(null)
            setNotice(null)
          }}
        >
          New key
        </button>
        <button
          type="button"
          className="button button--ghost"
          onClick={() => {
            setDialog('import')
            setError(null)
            setNotice(null)
          }}
        >
          Import
        </button>
      </div>

      {error ? <div className="keychain-panel__error">{error}</div> : null}
      {notice ? <div className="keychain-panel__notice">{notice}</div> : null}

      {dialog === 'generate' ? (
        <div className="keychain-panel__dialog">
          <label className="field">
            <span className="field__label">Name</span>
            <input
              className="field__input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="deploy-prod"
              autoComplete="off"
            />
          </label>

          <label className="field">
            <span className="field__label">Type</span>
            <select
              className="field__input"
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              <option value="ed25519">Ed25519</option>
              <option value="rsa">RSA (3072 bit)</option>
              <option value="ecdsa">ECDSA (nistp256)</option>
            </select>
          </label>

          <label className="field">
            <span className="field__label">Comment</span>
            <input
              className="field__input"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="optional"
              autoComplete="off"
            />
          </label>

          <label className="field">
            <span className="field__label">Passphrase</span>
            <input
              className="field__input"
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              placeholder="optional"
              autoComplete="new-password"
            />
          </label>

          <div className="keychain-panel__actions">
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setDialog('none')}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={busy || !name.trim()}
              onClick={() => void generate()}
            >
              {busy ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      ) : null}

      {dialog === 'import' ? (
        <div className="keychain-panel__dialog">
          <label className="field">
            <span className="field__label">Name</span>
            <input
              className="field__input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="imported-key"
              autoComplete="off"
            />
          </label>

          <label className="field">
            <span className="field__label">Private key</span>
            <textarea
              className="field__input field__input--area"
              value={privateKey}
              onChange={(event) => setPrivateKey(event.target.value)}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              rows={6}
              spellCheck={false}
            />
          </label>

          <label className="field">
            <span className="field__label">Passphrase</span>
            <input
              className="field__input"
              type="password"
              value={importPassphrase}
              onChange={(event) => setImportPassphrase(event.target.value)}
              placeholder="if the key is encrypted"
              autoComplete="off"
            />
          </label>

          <div className="keychain-panel__actions">
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setDialog('none')}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={busy || !name.trim() || !privateKey.trim()}
              onClick={() => void importKey()}
            >
              {busy ? 'Importing…' : 'Import'}
            </button>
          </div>
        </div>
      ) : null}

      {keys.length === 0 && dialog === 'none' ? (
        <div className="keychain-panel__empty">No keys yet</div>
      ) : null}

      {keys.map((key) => (
        <div key={key.id} className="keychain-panel__item">
          <div className="keychain-panel__item-head" onClick={() => setExpanded(expanded === key.id ? null : key.id)}>
            <span className="keychain-panel__name">{key.name}</span>
            <span className="keychain-panel__type">{KEY_TYPE_LABELS[key.type] ?? key.type}</span>
          </div>
          <div className="keychain-panel__meta">
            <span className="keychain-panel__fingerprint" title={key.fingerprint}>
              {key.fingerprint}
            </span>
            <span className="keychain-panel__date">{formatDate(key.createdAt)}</span>
          </div>

          {expanded === key.id ? (
            <div className="keychain-panel__detail">
              <code className="keychain-panel__public">{key.publicKey}</code>
              {key.comment ? (
                <div className="keychain-panel__comment">Comment: {key.comment}</div>
              ) : null}
              {key.hasPassphrase ? (
                <div className="keychain-panel__comment">Protected by a passphrase</div>
              ) : null}
              <div className="keychain-panel__actions">
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => void exportPublic(key)}
                >
                  Copy public key
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  disabled={busy}
                  onClick={() => void remove(key.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}
