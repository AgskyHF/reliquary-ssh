/** IPC handlers registered in the main process. */
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
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
import type { AppSettings } from '../services/settings'
import type { SyncEntry } from '@shared/sync'
import { SessionManager } from '../services/session-manager'
import { Storage, type TabRepository } from '../services/storage'
import { BackendClient } from '../services/backend-client'
import { KeychainService } from '../services/keychain'
import { MasterPasswordManager } from '../services/master-password'
import { SyncService } from '../services/sync'
import { SyncTransportRouter } from '../services/sync-transport'
import { getDeviceId, getDeviceSecret } from '../services/device-id'
import { logger } from '../services/logger'
import { broadcast } from './broadcast'

const sessionManager = new SessionManager()

let storage: Storage | null = null
let backend: BackendClient | null = null
let masterPassword: MasterPasswordManager | null = null
let keychain: KeychainService | null = null
let sync: SyncService | null = null
let transport: SyncTransportRouter | null = null

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

/**
 * The backend client.
 *
 * @param serverUrl The address of the backend. The environment variable
 * wins over the stored setting, so a developer can point the app at a
 * local server without touching the database.
 */
function getBackend(): BackendClient {
  if (!backend) {
    const stored = getStorage().settings.get('serverUrl')
    const serverUrl = process.env.RELIQUARY_SERVER_URL ?? stored

    backend = new BackendClient({ serverUrl })
  }
  return backend
}

/** Lazily created — app.getPath('userData') is only valid after ready. */
function getMasterPassword(): MasterPasswordManager {
  if (!masterPassword) {
    const userData = app.getPath('userData')
    masterPassword = new MasterPasswordManager(
      join(userData, 'master.json'),
      getDeviceSecret(userData)
    )
    // The stored file has to be read before the status is meaningful.
    // init() is idempotent, so it is safe to call it on every access.
    masterPassword.init()
  }
  return masterPassword
}

/**
 * The keychain service. It needs the master key, so it is only available
 * while the master password is unlocked.
 */
function getKeychain(): KeychainService {
  const material = getMasterPassword().getMasterKey()
  if (!material) {
    throw new Error('The master password is not set — the keychain is locked')
  }

  if (!keychain) {
    keychain = new KeychainService(getStorage().keys, material)
  }
  return keychain
}

/**
 * The transport router — the HTTP backend or a shared folder.
 *
 * The transport is a device setting: it decides where the encrypted
 * entries travel, not how they are encrypted.
 */
function getTransport(): SyncTransportRouter {
  if (!transport) {
    const settings = getStorage().settings.all()
    transport = new SyncTransportRouter(getBackend(), {
      transport: settings.syncTransport,
      serverUrl: settings.serverUrl,
      folder: settings.syncFolder
    })
  }
  return transport
}

/**
 * The sync engine — encryption, push and pull of the local changes.
 * It is built once and keeps its last-run state for the UI.
 */
function getSync(): SyncService {
  if (!sync) {
    sync = new SyncService(
      getStorage(),
      getMasterPassword(),
      getTransport(),
      () => getDeviceId(app.getPath('userData'))
    )
  }
  return sync
}

/**
 * Journals a key change for the sync backend.
 *
 * The keychain writes the row; the sync engine needs a trigger and the
 * device id of the row, which is why the change is recorded here and not
 * inside the keychain service.
 */
async function recordKeyChange(id: string): Promise<void> {
  const store = getStorage()
  const key = await store.keys.get(id)
  if (!key) return

  const deviceId = getDeviceId(app.getPath('userData'))
  const saved = { ...key, deviceId: key.deviceId || deviceId }
  await store.keys.save(saved)

  const now = new Date().toISOString()
  store.changes.record({
    id: crypto.randomUUID(),
    entity: 'keys',
    entityId: saved.id,
    operation: saved.deletedAt ? 'delete' : 'upsert',
    payload: JSON.stringify(saved),
    synced: false,
    createdAt: now,
    updatedAt: now,
    version: saved.version,
    deviceId
  })
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
      const options: ConnectionOptions = {
        host: request.host,
        port: request.port,
        username: request.username,
        authMethod: request.authMethod as AuthMethod,
        password: request.password,
        timeoutMs: 20_000
      }

      // Key authentication: the private key is decrypted in the main
      // process and never travels to the renderer.
      if (request.authMethod === 'key') {
        if (!request.keyId) throw new Error('Key authentication requires a key')
        options.privateKey = await getKeychain().privateKeyMaterial(request.keyId)
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
    return manager.status()
  })

  /**
   * Sets the master password of an account that already has one on the
   * server. The PBKDF2 salt travels with the account, so this device
   * derives exactly the key the other devices use.
   */
  handle(IPC.MASTER_SET_FROM_ACCOUNT, async (_event, password: string) => {
    // The folder transport has no account — the salt comes from the shared
    // folder instead of the backend.
    if (getTransport().transport === 'server' && !getBackend().isSignedIn()) {
      throw new Error('Sign in to the account first')
    }

    const params = await getSync().fetchKdfParams()
    if (!params) {
      throw new Error('The account has no master password yet — set a new one instead')
    }

    const manager = getMasterPassword()
    await manager.set(password, params)
    keychain = null
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

    // Every local change is journalled for the sync backend.
    storage.changes.record({
      id: crypto.randomUUID(),
      entity: 'hosts',
      entityId: saved.id,
      operation: 'upsert',
      payload: JSON.stringify(saved),
      synced: false,
      createdAt: now,
      updatedAt: now,
      version: saved.version,
      deviceId
    })

    return saved
  })

  handle(IPC.HOST_DELETE, async (_event, id: string) => {
    const storage = getStorage()
    storage.hosts.remove(id)

    const now = new Date().toISOString()
    storage.changes.record({
      id: crypto.randomUUID(),
      entity: 'hosts',
      entityId: id,
      operation: 'delete',
      payload: JSON.stringify({ id }),
      synced: false,
      createdAt: now,
      updatedAt: now,
      version: 2,
      deviceId: getDeviceId(app.getPath('userData'))
    })
  })

  // ---- auth ----
  handle(
    IPC.AUTH_REGISTER,
    async (_event, payload: { email: string; password: string }) =>
      getBackend().register(payload.email, payload.password)
  )

  handle(
    IPC.AUTH_LOGIN,
    async (_event, payload: { email: string; password: string }) =>
      getBackend().login(payload.email, payload.password)
  )

  handle(
    IPC.AUTH_LOGIN_GOOGLE,
    async (_event, payload: { code: string; codeVerifier?: string }) =>
      getBackend().loginWithGoogle(payload.code, payload.codeVerifier)
  )

  handle(IPC.AUTH_ME, async () => getBackend().me())

  handle(IPC.AUTH_SIGN_OUT, async () => {
    getBackend().signOut()
    getSync().reset()
  })

  handle(IPC.AUTH_STATUS, async () => {
    const client = getBackend()
    return {
      signedIn: client.isSignedIn(),
      email: client.signedInAs(),
      serverUrl: client.serverUrl
    }
  })

  handle(IPC.AUTH_SERVER_URL, async (_event, url: string) => {
    const client = getBackend()
    client.setServerUrl(url)
    getSync().reset()
    // The address is stored, so it survives a restart.
    getStorage().settings.set('serverUrl', url)
    return { serverUrl: client.serverUrl }
  })

  // ---- sync ----
  handle(
    IPC.SYNC_PUSH_ENTRIES,
    async (_event, payload: { entries: SyncEntry[] }) => ({
      accepted: await getBackend().pushEntries(payload.entries)
    })
  )

  handle(
    IPC.SYNC_PULL_ENTRIES,
    async (_event, payload?: { entity?: string }) => ({
      entries: await getBackend().pullEntries(payload?.entity)
    })
  )

  /** State of the engine plus what the sync screen needs to decide its form. */
  handle(IPC.SYNC_STATUS, async () => {
    const engine = getSync()
    return {
      ...engine.status(),
      serverUrl: getBackend().serverUrl,
      remoteKdf: await engine.hasRemoteKdf()
    }
  })

  handle(IPC.SYNC_NOW, async () => getSync().syncNow())

  // ---- settings ----
  handle(IPC.SETTINGS_GET, async () => getStorage().settings.all())

  handle(
    IPC.SETTINGS_SET,
    async (_event, payload: { key: keyof AppSettings; value: string }) => {
      const value = payload.value.trim()
      if (!value) throw new Error('The setting must not be empty')

      const settings = getStorage().settings

      switch (payload.key) {
        case 'serverUrl':
          // The client is the one that talks to the backend — it has to be
          // pointed at the new address as well.
          getBackend().setServerUrl(value)
          break
        case 'syncFolder':
          if (payload.value !== '' && !existsSync(value)) {
            throw new Error(`The folder does not exist: ${value}`)
          }
          break
        case 'syncTransport':
          if (value !== 'server' && value !== 'folder') {
            throw new Error(`Unknown transport: ${value}`)
          }
          break
        default:
          break
      }

      settings.set(payload.key, value)

      // The transport may have changed — the router has to follow it.
      const current = settings.all()
      getTransport().setSettings({
        transport: current.syncTransport,
        serverUrl: current.serverUrl,
        folder: current.syncFolder
      })
      getSync().reset()

      return settings.all()
    }
  )

  // ---- sync outbox ----
  handle(IPC.CHANGES_PENDING_COUNT, async () => getStorage().changes.count())

  // ---- keychain ----
  handle(IPC.KEY_LIST, async () => {
    // A locked keychain has no keys to show — the renderer shows the
    // unlock screen instead.
    if (!getMasterPassword().unlocked) return []
    return getKeychain().list()
  })

  handle(
    IPC.KEY_GENERATE,
    async (
      _event,
      payload: { name: string; type: string; passphrase?: string; comment?: string; bits?: number }
    ) => {
      const summary = await getKeychain().generate(payload)
      await recordKeyChange(summary.id)
      return summary
    }
  )

  handle(
    IPC.KEY_IMPORT,
    async (
      _event,
      payload: { name: string; privateKey: string; passphrase?: string; comment?: string }
    ) => {
      const summary = await getKeychain().import(payload)
      await recordKeyChange(summary.id)
      return summary
    }
  )

  handle(IPC.KEY_DELETE, async (_event, id: string) => {
    await getKeychain().remove(id)
    // The row is soft-deleted; the tombstone has to reach the other devices.
    await recordKeyChange(id)
  })

  handle(IPC.KEY_EXPORT_PUBLIC, async (_event, id: string) =>
    getKeychain().exportPublic(id)
  )

  // Host handlers are wired in a later stage.
  // The channels exist from stage 1 so the renderer contract is stable.
}

export { sessionManager }
