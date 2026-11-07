/** IPC handlers registered in the main process. */
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
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
import type { SyncEntry } from '@shared/sync'
import { SessionManager } from '../services/session-manager'
import { Storage, type TabRepository } from '../services/storage'
import { BackendClient } from '../services/backend-client'
import { KeychainService } from '../services/keychain'
import { MasterPasswordManager } from '../services/master-password'
import { SyncService } from '../services/sync'
import { getDeviceId, getDeviceSecret } from '../services/device-id'
import { broadcast } from './broadcast'

const sessionManager = new SessionManager()

let storage: Storage | null = null
let backend: BackendClient | null = null
let masterPassword: MasterPasswordManager | null = null
let keychain: KeychainService | null = null
let sync: SyncService | null = null

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
 * The requests run in the main process: the renderer is loaded from a
 * file:// origin and Chromium blocks such pages from reaching the local
 * network.
 */
function getBackend(): BackendClient {
  if (!backend) {
    backend = new BackendClient({
      serverUrl: process.env.RELIQUARY_SERVER_URL ?? DEFAULT_SERVER_URL
    })
  }
  return backend
}

/** The default address of the sync backend. */
const DEFAULT_SERVER_URL = 'http://127.0.0.1:8790'

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
 * The sync engine — encryption, push and pull of the local changes.
 * It is built once and keeps its last-run state for the UI.
 */
function getSync(): SyncService {
  if (!sync) {
    sync = new SyncService(
      getStorage(),
      getMasterPassword(),
      getBackend(),
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
  broadcast(IPC.SESSION_ERROR, { sessionId, message })
})

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.APP_INFO, () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform
  }))

  ipcMain.handle(
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

  ipcMain.handle(
    IPC.SESSION_WRITE,
    (_event, payload: { sessionId: string; data: string }): void => {
      sessionManager.write(payload.sessionId, payload.data)
    }
  )

  ipcMain.handle(
    IPC.SESSION_RESIZE,
    (_event, payload: { sessionId: string; cols: number; rows: number }): void => {
      sessionManager.resize(payload.sessionId, payload.cols, payload.rows)
    }
  )

  ipcMain.handle(IPC.SESSION_DISCONNECT, async (_event, sessionId: string): Promise<void> => {
    await sessionManager.disconnect(sessionId)
  })

  ipcMain.handle(IPC.TAB_SNAPSHOT_LOAD, async () => getTabStore().load())
  ipcMain.handle(IPC.TAB_SNAPSHOT_SAVE, async (_event, input: TabLayoutInput) =>
    getTabStore().save(input)
  )

  ipcMain.handle(
    IPC.FILE_LIST,
    async (_event, payload: { sessionId: string; path: string }) =>
      sessionManager.listFiles(payload.sessionId, payload.path)
  )

  ipcMain.handle(
    IPC.FILE_DOWNLOAD,
    async (
      _event,
      payload: { sessionId: string; remotePath: string; localPath: string }
    ) => sessionManager.download(payload.sessionId, payload)
  )

  ipcMain.handle(
    IPC.FILE_UPLOAD,
    async (
      _event,
      payload: { sessionId: string; remotePath: string; localPath: string }
    ) => sessionManager.upload(payload.sessionId, payload)
  )

  ipcMain.handle(IPC.FILE_CWD, async (_event, sessionId: string) =>
    sessionManager.cwd(sessionId)
  )

  // Native file picker — the only place the app touches the OS dialog.
  // dialog.showOpenDialog/showSaveDialog are cross-platform Electron APIs.
  ipcMain.handle(
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
  ipcMain.handle(IPC.MASTER_SET, async (_event, password: string) => {
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
  ipcMain.handle(IPC.MASTER_SET_FROM_ACCOUNT, async (_event, password: string) => {
    if (!getBackend().isSignedIn()) throw new Error('Sign in to the account first')

    const params = await getSync().fetchKdfParams()
    if (!params) {
      throw new Error('The account has no master password yet — set a new one instead')
    }

    const manager = getMasterPassword()
    await manager.set(password, params)
    keychain = null
    return manager.status()
  })

  ipcMain.handle(IPC.MASTER_HAS, async () => getMasterPassword().has())

  ipcMain.handle(IPC.MASTER_VERIFY, async (_event, password: string) =>
    getMasterPassword().verify(password)
  )

  ipcMain.handle(IPC.MASTER_UNLOCK, async (_event, password: string) => {
    const manager = getMasterPassword()
    if (!manager.unlock(password)) {
      throw new Error('Wrong master password')
    }
    // The keychain is rebuilt with the freshly loaded material.
    keychain = null
    return manager.status()
  })

  ipcMain.handle(IPC.MASTER_CLEAR, async () => {
    getMasterPassword().lock()
    keychain = null
  })

  ipcMain.handle(IPC.MASTER_STATUS, async () => getMasterPassword().status())

  // ---- hosts ----
  ipcMain.handle(IPC.HOST_LIST, async () => getStorage().hosts.list())

  ipcMain.handle(IPC.HOST_SAVE, async (_event, host: Partial<Host>) => {
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

  ipcMain.handle(IPC.HOST_DELETE, async (_event, id: string) => {
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
  ipcMain.handle(
    IPC.AUTH_REGISTER,
    async (_event, payload: { email: string; password: string }) =>
      getBackend().register(payload.email, payload.password)
  )

  ipcMain.handle(
    IPC.AUTH_LOGIN,
    async (_event, payload: { email: string; password: string }) =>
      getBackend().login(payload.email, payload.password)
  )

  ipcMain.handle(
    IPC.AUTH_LOGIN_GOOGLE,
    async (_event, payload: { code: string; codeVerifier?: string }) =>
      getBackend().loginWithGoogle(payload.code, payload.codeVerifier)
  )

  ipcMain.handle(IPC.AUTH_ME, async () => getBackend().me())

  ipcMain.handle(IPC.AUTH_SIGN_OUT, async () => {
    getBackend().signOut()
    getSync().reset()
  })

  ipcMain.handle(IPC.AUTH_STATUS, async () => {
    const client = getBackend()
    return {
      signedIn: client.isSignedIn(),
      email: client.signedInAs(),
      serverUrl: client.serverUrl
    }
  })

  ipcMain.handle(IPC.AUTH_SERVER_URL, async (_event, url: string) => {
    const client = getBackend()
    client.setServerUrl(url)
    getSync().reset()
    return { serverUrl: client.serverUrl }
  })

  // ---- sync ----
  ipcMain.handle(
    IPC.SYNC_PUSH_ENTRIES,
    async (_event, payload: { entries: SyncEntry[] }) => ({
      accepted: await getBackend().pushEntries(payload.entries)
    })
  )

  ipcMain.handle(
    IPC.SYNC_PULL_ENTRIES,
    async (_event, payload?: { entity?: string }) => ({
      entries: await getBackend().pullEntries(payload?.entity)
    })
  )

  /** State of the engine plus what the sync screen needs to decide its form. */
  ipcMain.handle(IPC.SYNC_STATUS, async () => {
    const engine = getSync()
    return {
      ...engine.status(),
      serverUrl: getBackend().serverUrl,
      remoteKdf: await engine.hasRemoteKdf()
    }
  })

  ipcMain.handle(IPC.SYNC_NOW, async () => getSync().syncNow())

  // ---- sync outbox ----
  ipcMain.handle(IPC.CHANGES_PENDING_COUNT, async () => getStorage().changes.count())

  // ---- keychain ----
  ipcMain.handle(IPC.KEY_LIST, async () => {
    // A locked keychain has no keys to show — the renderer shows the
    // unlock screen instead.
    if (!getMasterPassword().unlocked) return []
    return getKeychain().list()
  })

  ipcMain.handle(
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

  ipcMain.handle(
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

  ipcMain.handle(IPC.KEY_DELETE, async (_event, id: string) => {
    await getKeychain().remove(id)
    // The row is soft-deleted; the tombstone has to reach the other devices.
    await recordKeyChange(id)
  })

  ipcMain.handle(IPC.KEY_EXPORT_PUBLIC, async (_event, id: string) =>
    getKeychain().exportPublic(id)
  )

  // Host handlers are wired in a later stage.
  // The channels exist from stage 1 so the renderer contract is stable.
}

export { sessionManager }
