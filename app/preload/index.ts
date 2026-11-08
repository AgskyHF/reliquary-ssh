/** Preload script — the only bridge between renderer and main. */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/types'
import type { ReliquaryApi } from '@shared/api'

const api: ReliquaryApi = {
  appInfo: (): Promise<{ name: string; version: string; platform: string }> =>
    ipcRenderer.invoke(IPC.APP_INFO),

  host: {
    list: () => ipcRenderer.invoke(IPC.HOST_LIST),
    save: (host) => ipcRenderer.invoke(IPC.HOST_SAVE, host),
    remove: (id) => ipcRenderer.invoke(IPC.HOST_DELETE, id)
  },

  key: {
    list: () => ipcRenderer.invoke(IPC.KEY_LIST),
    generate: (payload) => ipcRenderer.invoke(IPC.KEY_GENERATE, payload),
    import: (payload) => ipcRenderer.invoke(IPC.KEY_IMPORT, payload),
    remove: (id) => ipcRenderer.invoke(IPC.KEY_DELETE, id),
    exportPublic: (id) => ipcRenderer.invoke(IPC.KEY_EXPORT_PUBLIC, id)
  },

  master: {
    set: (password) => ipcRenderer.invoke(IPC.MASTER_SET, password),
    setFromAccount: (password) => ipcRenderer.invoke(IPC.MASTER_SET_FROM_ACCOUNT, password),
    has: () => ipcRenderer.invoke(IPC.MASTER_HAS),
    verify: (password) => ipcRenderer.invoke(IPC.MASTER_VERIFY, password),
    unlock: (password) => ipcRenderer.invoke(IPC.MASTER_UNLOCK, password),
    clear: () => ipcRenderer.invoke(IPC.MASTER_CLEAR),
    status: () => ipcRenderer.invoke(IPC.MASTER_STATUS)
  },

  settings: {
    get: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
    set: (payload) => ipcRenderer.invoke(IPC.SETTINGS_SET, payload)
  },

  transfer: {
    export: (payload) => ipcRenderer.invoke(IPC.EXPORT_BUILD, payload),
    import: (payload) => ipcRenderer.invoke(IPC.EXPORT_IMPORT, payload),
    superseded: () => ipcRenderer.invoke(IPC.EXPORT_SUPERSEDED_LIST),
    restore: (payload) => ipcRenderer.invoke(IPC.EXPORT_SUPERSEDED_RESTORE, payload),
    forget: (payload) => ipcRenderer.invoke(IPC.EXPORT_SUPERSEDED_REMOVE, payload)
  },

  hostPassword: {
    set: (payload) => ipcRenderer.invoke(IPC.HOST_PASSWORD_SET, payload),
    remove: (payload) => ipcRenderer.invoke(IPC.HOST_PASSWORD_REMOVE, payload),
    has: (payload) => ipcRenderer.invoke(IPC.HOST_PASSWORD_HAS, payload),
    saveFromConnect: (payload) =>
      ipcRenderer.invoke(IPC.HOST_PASSWORD_SAVE_FROM_CONNECT, payload)
  },

  session: {
    connect: (request) => ipcRenderer.invoke(IPC.SESSION_CONNECT, request),
    write: (payload) => ipcRenderer.invoke(IPC.SESSION_WRITE, payload),
    resize: (payload) => ipcRenderer.invoke(IPC.SESSION_RESIZE, payload),
    disconnect: (sessionId) => ipcRenderer.invoke(IPC.SESSION_DISCONNECT, sessionId),
    onData: (listener) => {
      const handler = (_event: unknown, payload: { sessionId: string; chunk: string }) =>
        listener(payload)
      ipcRenderer.on(IPC.SESSION_DATA, handler)
      return () => ipcRenderer.removeListener(IPC.SESSION_DATA, handler)
    },
    onState: (listener) => {
      const handler = (_event: unknown, payload: { sessionId: string; state: string }) =>
        listener(payload)
      ipcRenderer.on(IPC.SESSION_STATE, handler)
      return () => ipcRenderer.removeListener(IPC.SESSION_STATE, handler)
    },
    onError: (listener) => {
      const handler = (_event: unknown, payload: { sessionId: string; message: string }) =>
        listener(payload)
      ipcRenderer.on(IPC.SESSION_ERROR, handler)
      return () => ipcRenderer.removeListener(IPC.SESSION_ERROR, handler)
    }
  },

  file: {
    list: (payload) => ipcRenderer.invoke(IPC.FILE_LIST, payload),
    download: (payload) => ipcRenderer.invoke(IPC.FILE_DOWNLOAD, payload),
    upload: (payload) => ipcRenderer.invoke(IPC.FILE_UPLOAD, payload),
    cwd: (sessionId) => ipcRenderer.invoke(IPC.FILE_CWD, sessionId),
    pickLocalPath: (payload) => ipcRenderer.invoke(IPC.FILE_PICK_LOCAL, payload)
  },

  changes: {
    pendingCount: () => ipcRenderer.invoke(IPC.CHANGES_PENDING_COUNT)
  },

  auth: {
    register: (payload) => ipcRenderer.invoke(IPC.AUTH_REGISTER, payload),
    login: (payload) => ipcRenderer.invoke(IPC.AUTH_LOGIN, payload),
    loginWithGoogle: (payload) => ipcRenderer.invoke(IPC.AUTH_LOGIN_GOOGLE, payload),
    me: () => ipcRenderer.invoke(IPC.AUTH_ME),
    signOut: () => ipcRenderer.invoke(IPC.AUTH_SIGN_OUT),
    status: () => ipcRenderer.invoke(IPC.AUTH_STATUS),
    setServerUrl: (url) => ipcRenderer.invoke(IPC.AUTH_SERVER_URL, url)
  },

  sync: {
    push: (payload) => ipcRenderer.invoke(IPC.SYNC_PUSH_ENTRIES, payload),
    pull: (payload) => ipcRenderer.invoke(IPC.SYNC_PULL_ENTRIES, payload),
    status: () => ipcRenderer.invoke(IPC.SYNC_STATUS),
    now: () => ipcRenderer.invoke(IPC.SYNC_NOW),
    autoStatus: () => ipcRenderer.invoke(IPC.SYNC_AUTO_STATUS)
  },

  tab: {
    load: () => ipcRenderer.invoke(IPC.TAB_SNAPSHOT_LOAD),
    save: (input) => ipcRenderer.invoke(IPC.TAB_SNAPSHOT_SAVE, input)
  }
}

contextBridge.exposeInMainWorld('reliquary', api)
