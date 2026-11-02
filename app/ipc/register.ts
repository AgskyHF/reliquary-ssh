/** IPC handlers registered in the main process. */
import { app, ipcMain } from 'electron'
import { AuthMethod, IPC, ProtocolType, type ConnectionOptions } from '@shared/types'
import type { ConnectRequest } from '@shared/api'
import { SessionManager } from '../services/session-manager'
import { broadcast } from './broadcast'

const sessionManager = new SessionManager()

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

      await sessionManager.connect(request.sessionId, ProtocolType.SSH, options)
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

  // Host / key / tab handlers are wired in later stages.
  // The channels exist from stage 1 so the renderer contract is stable.
}

export { sessionManager }
