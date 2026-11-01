/** IPC handlers registered in the main process. */
import { app, ipcMain } from 'electron'
import { IPC } from '@shared/types'

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.APP_INFO, () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform
  }))

  // Host / key / tab / session handlers are wired in later stages.
  // The channels exist from stage 1 so the renderer contract is stable.
}
