/** IPC handlers registered in the main process. */
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AuthMethod,
  IPC,
  ProtocolType,
  type ConnectionOptions,
  type Host,
  type TabLayoutInput
} from '@shared/types'
import type { ConnectRequest } from '@shared/api'
import type { MasterKeyMaterial } from '../services/crypto'
import type { AppSettings, SupersededSummary } from '@shared/api'
import type { ExportOptions } from '@shared/export'
import { EXPORT_FILE_NAME } from '@shared/export'
import { SessionManager } from '../services/session-manager'
import { Storage, type TabRepository } from '../services/storage'
import { KeychainService } from '../services/keychain'
import { MasterPasswordManager } from '../services/master-password'
import { ExportService } from '../services/export'
import { RestoreService } from '../services/restore'
import { getDeviceId, getDeviceSecret } from '../services/device-id'
import { logger } from '../services/logger'
import { broadcast } from './broadcast'

const sessionManager = new SessionManager()

let storage: Storage | null = null
let masterPassword: MasterPasswordManager | null = null
let keychain: KeychainService | null = null
let exporter: ExportService | null = null
let restorer: RestoreService | null = null

/** The export/import service. */
function getExport(): ExportService {
  if (!exporter) {
    exporter = new ExportService(getStorage(), getMasterPassword())
  }
  return exporter
}

/** The service that brings a replaced version back. */
function getRestore(): RestoreService {
  if (!restorer) {
    restorer = new RestoreService(getStorage())
  }
  return restorer
}

/** Lazily created — app.getPath('userData') is only valid after ready. */
function getStorage(): Storage {
  if (!storage) {
    const userData = app.getPath('userData')
    storage = Storage.inUserData(userData)
  }
  return storage
}

/** Lazily created — app.getPath('userData') is only valid after ready. */
function getTabStore(): TabRepository {
  return getStorage().tabs
}

/** Lazily created — app.getPath('userData') is only valid after ready. */
/**
 * The key the passwords of the hosts are sealed with.
 *
 * The passwords of the hosts belong to the device: they are sealed with
 * the device secret, so they are readable without a master password and
 * survive a restart. A master password, when the user has one, protects
 * the keys — not this.
 */
function getPasswordMaterial(): MasterKeyMaterial {
  return getMasterPassword().deviceKey()
}

/**
 * The plaintext password of a host, or null.
 *
 * The passwords of the older builds were sealed with the master key when
 * it was unlocked, so it is tried as a second key — otherwise a password
 * that was saved then would look lost.
 */
function revealPassword(hostId: string): string | null {
  const storage = getStorage()
  const direct = storage.passwords.reveal(hostId, getPasswordMaterial())
  if (direct !== null) return direct

  const material = getMasterPassword().getMasterKey()
  return material ? storage.passwords.reveal(hostId, material) : null
}

/**
 * The name of the next copy of a host: "Server" becomes "Server (copy)",
 * and a second copy becomes "Server (copy 2)".
 *
 * The name is a marker, not a word of the interface — it stays the same
 * in every language.
 */
function nextCopyName(name: string, hosts: Host[]): string {
  const taken = new Set(hosts.map((host) => host.name))
  const base = `${name} (copy)`

  if (!taken.has(base)) return base

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${name} (copy ${index})`
    if (!taken.has(candidate)) return candidate
  }

  return `${base} ${Date.now()}`
}

function getMasterPassword(): MasterPasswordManager {
  if (!masterPassword) {
    const userData = app.getPath('userData')
    masterPassword = new MasterPasswordManager(
      join(userData, 'master.json'),
      getDeviceSecret(userData)
    )
    // The import brings the salt of the account — the manager reads it
    // when the master password is set, so this device derives the same
    // key as the device that made the export.
    masterPassword.readImportedKdf = () => {
      const raw = getStorage().settings.get('importedKdf')
      return raw === '' ? null : raw
    }
    // The stored file has to be read before the status is meaningful.
    // init() is idempotent, so it is safe to call it on every access.
    masterPassword.init()
  }
  return masterPassword
}

/**
 * The keychain service.
 *
 * The private keys are sealed with the key of the device, so the panel
 * works without a master password. A key of an older build was sealed
 * with the master key — that one opens while the app is unlocked.
 */
function getKeychain(): KeychainService {
  if (!keychain) {
    keychain = new KeychainService(
      getStorage().keys,
      getMasterPassword().deviceKey(),
      () => getMasterPassword().getMasterKey()
    )
  }
  return keychain
}

sessionManager.on('data', ({ sessionId, chunk }) => {
  broadcast(IPC.SESSION_DATA, { sessionId, chunk })
})

sessionManager.on('state', ({ sessionId, state }) => {
  broadcast(IPC.SESSION_STATE, { sessionId, state })
})

sessionManager.on('sessionError', ({ sessionId, message }) => {
  logger.warn(`Session ${sessionId} failed: ${message}`)
  broadcast(IPC.SESSION_ERROR, { sessionId, message })
})

/**
 * Registers an IPC handler that logs its failures.
 *
 * The handler keeps the usual (event, payload) signature — the wrapper
 * only adds the logging around it.
 */
function handle(
  channel: string,
  handler: (...args: never[]) => unknown
): void {
  ipcMain.handle(channel, async (event: unknown, ...args: unknown[]) => {
    try {
      return await (handler as (...values: unknown[]) => unknown)(event, ...args)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`IPC ${channel} failed: ${message}`, error instanceof Error ? error.stack : '')
      throw error instanceof Error ? error : new Error(message)
    }
  })
}

export function registerIpcHandlers(): void {
  handle(IPC.APP_INFO, () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform
  }))

  handle(
    IPC.SESSION_CONNECT,
    async (_event, request: ConnectRequest): Promise<void> => {
      // A saved host carries its own endpoint and its credentials. The
      // password stays in the main process — it never travels to the
      // renderer, so the renderer only names the host.
      const host = request.hostId ? getStorage().hosts.get(request.hostId) : null

      if (request.hostId && !host) {
        // A code, not a sentence: the renderer turns it into the words
        // of the language the user chose.
        throw new Error('HOST_GONE')
      }

      const authMethod = (host?.authMethod ?? request.authMethod) as AuthMethod
      const options: ConnectionOptions = {
        host: host?.host ?? request.host,
        port: host?.port ?? request.port,
        username: host?.username ?? request.username,
        authMethod,
        password: request.password,
        timeoutMs: 20_000
      }

      // The password of a saved host comes from the encrypted store.
      if (host && authMethod === AuthMethod.PASSWORD && !options.password) {
        options.password = revealPassword(host.id) ?? undefined

        // A host without a stored password needs one — the session would
        // fail with an error that says nothing about the cause.
        if (!options.password) {
          throw new Error('The host has no stored password — enter it in the form')
        }
      }

      // Key authentication: the private key is decrypted in the main
      // process and never travels to the renderer.
      if (authMethod === AuthMethod.KEY) {
        const keyId = host?.keyId ?? request.keyId
        if (!keyId) throw new Error('Key authentication requires a key')
        options.privateKey = await getKeychain().privateKeyMaterial(keyId)
      }

      const protocol =
        request.protocol === 'sftp' ? ProtocolType.SFTP : ProtocolType.SSH

      await sessionManager.connect(request.sessionId, protocol, options)
    }
  )

  handle(
    IPC.SESSION_WRITE,
    (_event, payload: { sessionId: string; data: string }): void => {
      sessionManager.write(payload.sessionId, payload.data)
    }
  )

  handle(
    IPC.SESSION_RESIZE,
    (_event, payload: { sessionId: string; cols: number; rows: number }): void => {
      sessionManager.resize(payload.sessionId, payload.cols, payload.rows)
    }
  )

  handle(IPC.SESSION_DISCONNECT, async (_event, sessionId: string): Promise<void> => {
    await sessionManager.disconnect(sessionId)
  })

  handle(IPC.TAB_SNAPSHOT_LOAD, async () => getTabStore().load())
  handle(IPC.TAB_SNAPSHOT_SAVE, async (_event, input: TabLayoutInput) =>
    getTabStore().save(input)
  )

  handle(
    IPC.FILE_LIST,
    async (_event, payload: { sessionId: string; path: string }) =>
      sessionManager.listFiles(payload.sessionId, payload.path)
  )

  handle(
    IPC.FILE_DOWNLOAD,
    async (
      _event,
      payload: { sessionId: string; remotePath: string; localPath: string }
    ) => sessionManager.download(payload.sessionId, payload)
  )

  handle(
    IPC.FILE_UPLOAD,
    async (
      _event,
      payload: { sessionId: string; remotePath: string; localPath: string }
    ) => sessionManager.upload(payload.sessionId, payload)
  )

  handle(IPC.FILE_CWD, async (_event, sessionId: string) =>
    sessionManager.cwd(sessionId)
  )

  // Native file picker — the only place the app touches the OS dialog.
  // dialog.showOpenDialog/showSaveDialog are cross-platform Electron APIs.
  handle(
    IPC.FILE_PICK_LOCAL,
    async (
      _event,
      payload: { mode: 'open' | 'save'; defaultPath?: string }
    ): Promise<string | null> => {
      const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      if (!window) return null

      if (payload.mode === 'save') {
        const result = await dialog.showSaveDialog(window, {
          defaultPath: payload.defaultPath,
          title: 'Choose where to save the file'
        })
        return result.canceled ? null : (result.filePath ?? null)
      }

      const result = await dialog.showOpenDialog(window, {
        defaultPath: payload.defaultPath,
        title: 'Choose a file',
        properties: ['openFile']
      })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    }
  )

  // ---- master password ----
  handle(IPC.MASTER_SET, async (_event, password: string) => {
    const manager = getMasterPassword()
    await manager.set(password)
    // The keychain must be rebuilt with the new material.
    keychain = null
    // An import may have brought sealed passwords — they open now.
    const material = manager.getMasterKey()
    if (material) await getExport().openSealedPasswords(material)
    return manager.status()
  })

  handle(IPC.MASTER_HAS, async () => getMasterPassword().has())

  handle(IPC.MASTER_VERIFY, async (_event, password: string) =>
    getMasterPassword().verify(password)
  )

  handle(IPC.MASTER_UNLOCK, async (_event, password: string) => {
    const manager = getMasterPassword()
    if (!manager.unlock(password)) {
      throw new Error('Wrong master password')
    }
    // The keychain is rebuilt with the freshly loaded material.
    keychain = null
    return manager.status()
  })

  handle(IPC.MASTER_CLEAR, async () => {
    getMasterPassword().lock()
    keychain = null
  })

  handle(IPC.MASTER_STATUS, async () => getMasterPassword().status())

  // ---- hosts ----
  handle(IPC.HOST_LIST, async () => getStorage().hosts.list())

  handle(IPC.HOST_SAVE, async (_event, host: Partial<Host>) => {
    const storage = getStorage()
    const now = new Date().toISOString()
    const deviceId = getDeviceId(app.getPath('userData'))

    // A partial update keeps the stored fields: a form only sends what it
    // changed, and the version has to grow from the row, not from the
    // payload — otherwise an edit would look older than the replica it
    // was made from.
    const existing = host.id ? storage.hosts.get(host.id) : null

    const saved = storage.hosts.save({
      ...existing,
      ...host,
      id: host.id ?? crypto.randomUUID(),
      createdAt: existing?.createdAt ?? host.createdAt ?? now,
      updatedAt: now,
      version: (existing?.version ?? 0) + 1,
      deviceId
    })

    return saved
  })

  /**
   * Makes a copy of a host.
   *
   * The copy gets a new id and a name that says it is a copy. The
   * password travels with it, so the copy can be connected to right
   * away.
   */
  handle(IPC.HOST_DUPLICATE, async (_event, id: string): Promise<Host> => {
    const storage = getStorage()
    const source = storage.hosts.get(id)
    if (!source) throw new Error('Unknown host')

    const now = new Date().toISOString()
    const copy = storage.hosts.save({
      ...source,
      id: crypto.randomUUID(),
      name: nextCopyName(source.name, storage.hosts.list()),
      notes: source.notes,
      createdAt: now,
      updatedAt: now,
      version: 1,
      deletedAt: null
    })

    // The password of the host is copied too — otherwise the copy would
    // be useless right away.
    const stored = storage.passwords.get(id)
    if (stored) {
      storage.passwords.saveSealed(copy.id, stored.encryptedPassword, stored.deviceId)
    }

    return copy
  })

  handle(IPC.HOST_DELETE, async (_event, id: string) => {
    getStorage().hosts.remove(id)
  })

  // ---- settings ----
  handle(IPC.SETTINGS_GET, async () => getStorage().settings.all())

  handle(
    IPC.SETTINGS_SET,
    async (_event, payload: { key: keyof AppSettings; value: string }) => {
      const value = payload.value.trim()
      if (!value) throw new Error('The setting must not be empty')

      const settings = getStorage().settings

      settings.set(payload.key, value)
      return settings.all()
    }
  )

  // ---- export and import ----
  handle(
    IPC.EXPORT_BUILD,
    async (_event, payload: { options: ExportOptions; path?: string }) => {
      const options = payload.options
      let target = payload.path

      if (!target) {
        const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
        if (!window) throw new Error('The app window is not available')

        const result = await dialog.showSaveDialog(window, {
          title: 'Export the connections',
          defaultPath: EXPORT_FILE_NAME,
          filters: [{ name: 'ReliquarySSH export', extensions: ['zip'] }]
        })
        if (result.canceled || !result.filePath) {
          return { path: '', summary: 'Cancelled' }
        }
        target = result.filePath
      }

      const built = await getExport().build(options, app.getVersion())
      writeFileSync(target, built.buffer)

      return {
        path: target,
        summary:
          options.mode === 'with-passwords'
            ? `Exported with ${built.passwords} passwords`
            : 'Exported without the passwords',
        passwords: built.passwords,
        unreadable: built.unreadable
      }
    }
  )

  handle(IPC.EXPORT_IMPORT, async (_event, payload?: { path?: string }) => {
    let target = payload?.path

    if (!target) {
      const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      if (!window) throw new Error('The app window is not available')

      const result = await dialog.showOpenDialog(window, {
        title: 'Import the connections',
        properties: ['openFile'],
        filters: [{ name: 'ReliquarySSH export', extensions: ['zip'] }]
      })
      if (result.canceled || result.filePaths.length === 0) {
        return {
          added: 0,
          updated: 0,
          unchanged: 0,
          superseded: 0,
          keysAdded: 0,
          undecryptable: 0,
          summary: 'Cancelled'
        }
      }
      target = result.filePaths[0]
    }

    const buffer = readFileSync(target)
    const material = getMasterPassword().getMasterKey()

    return getExport().import(buffer, material)
  })

  handle(IPC.EXPORT_SUPERSEDED_LIST, async (): Promise<SupersededSummary[]> => {
    const storage = getStorage()

    return storage.superseded.list().map((record) => {
      let name = record.hostId
      let target = ''
      let updatedAt = record.replacedAt
      let hasPassword = false

      try {
        const payload = JSON.parse(record.payload) as {
          connection?: {
            name?: string
            host?: string
            port?: number
            username?: string
            updatedAt?: string
          }
          encryptedPassword?: string | null
        }
        name = payload.connection?.name ?? record.hostId
        target = payload.connection
          ? `${payload.connection.username ?? ''}@${payload.connection.host ?? ''}:${payload.connection.port ?? 22}`
          : ''
        updatedAt = payload.connection?.updatedAt ?? record.replacedAt
        hasPassword = Boolean(payload.encryptedPassword)
      } catch {
        // A broken payload still shows the id.
      }

      // The version that won — the current one. The user wants to see
      // both: what was replaced and what replaced it.
      const current = storage.hosts.getIncludingDeleted(record.replacedBy)

      return {
        id: record.id,
        hostId: record.hostId,
        name,
        target,
        updatedAt,
        replacedAt: record.replacedAt,
        reason: record.reason,
        hasPassword,
        currentName: current?.name ?? '',
        currentTarget: current
          ? `${current.username}@${current.host}:${current.port}`
          : '',
        currentUpdatedAt: current?.updatedAt ?? ''
      }
    })
  })

  // ---- restoring a replaced version ----
  handle(IPC.EXPORT_SUPERSEDED_RESTORE, async (_event, payload: { id: string }) => {
    // The passwords of the hosts are sealed with the device secret, so
    // the restore opens them without a master password.
    return getRestore().restore(payload.id, getPasswordMaterial())
  })

  handle(IPC.EXPORT_SUPERSEDED_REMOVE, async (_event, payload: { id: string }) => {
    getStorage().superseded.remove(payload.id)
  })

  handle(IPC.EXPORT_SUPERSEDED_REMOVE_ALL, async (): Promise<{ removed: number }> => {
    const removed = getStorage().superseded.removeAll()
    logger.info('The old folder was emptied', { removed })
    return { removed }
  })

  // ---- host passwords ----
  handle(IPC.HOST_PASSWORD_SET, async (_event, payload: { hostId: string; password: string }) => {
    const material = getPasswordMaterial()

    getStorage().passwords.save(
      payload.hostId,
      payload.password,
      material,
      getDeviceId(app.getPath('userData'))
    )
    return { stored: true }
  })

  handle(IPC.HOST_PASSWORD_REMOVE, async (_event, payload: { hostId: string }) => {
    getStorage().passwords.remove(payload.hostId)
  })

  handle(IPC.HOST_PASSWORD_HAS, async (_event, payload: { hostId: string }) => {
    return getStorage().passwords.has(payload.hostId)
  })

  /**
   * Saves the password of a host that was just connected to.
   *
   * The password is tied to a host id, so a connection made from the
   * ad-hoc form (no host in the list) does not store anything — there is
   * nothing to attach it to.
   */
  handle(
    IPC.HOST_PASSWORD_SAVE_FROM_CONNECT,
    async (_event, payload: { hostId: string | null; password: string }) => {
      if (!payload.hostId) return { stored: false }
      if (!payload.password) return { stored: false }

      const material = getPasswordMaterial()

      getStorage().passwords.save(
        payload.hostId,
        payload.password,
        material,
        getDeviceId(app.getPath('userData'))
      )
      return { stored: true }
    }
  )

  // ---- keychain ----
  handle(IPC.KEY_LIST, async () => {
    // The list of the keys needs no master password — only the private
    // part of a key of an older build does.
    return getKeychain().list()
  })

  handle(
    IPC.KEY_GENERATE,
    async (
      _event,
      payload: { name: string; type: string; passphrase?: string; comment?: string; bits?: number }
    ) => {
      return getKeychain().generate(payload)
    }
  )

  handle(
    IPC.KEY_IMPORT,
    async (
      _event,
      payload: { name: string; privateKey: string; passphrase?: string; comment?: string }
    ) => {
      return getKeychain().import(payload)
    }
  )

  handle(IPC.KEY_DELETE, async (_event, id: string) => {
    await getKeychain().remove(id)
  })

  handle(IPC.KEY_EXPORT_PUBLIC, async (_event, id: string) =>
    getKeychain().exportPublic(id)
  )

  // Host handlers are wired in a later stage.
  // The channels exist from stage 1 so the renderer contract is stable.
}

export { sessionManager }
