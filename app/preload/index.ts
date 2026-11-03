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
    has: () => ipcRenderer.invoke(IPC.MASTER_HAS),
    verify: (password) => ipcRenderer.invoke(IPC.MASTER_VERIFY, password),
    unlock: (password) => ipcRenderer.invoke(IPC.MASTER_UNLOCK, password),
    clear: () => ipcRenderer.invoke(IPC.MASTER_CLEAR),
    status: () => ipcRenderer.invoke(IPC.MASTER_STATUS)
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

  tab: {
    load: () => ipcRenderer.invoke(IPC.TAB_SNAPSHOT_LOAD),
    save: (input) => ipcRenderer.invoke(IPC.TAB_SNAPSHOT_SAVE, input)
  }
}

contextBridge.exposeInMainWorld('reliquary', api)
