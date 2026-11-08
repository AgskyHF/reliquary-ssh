/** Electron main process entry point. */
import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { registerIpcHandlers, sessionManager } from './ipc/register'
import { logger } from './services/logger'

const isDev = !app.isPackaged

// Headless verification mode: offscreen rendering, no window, no Dock icon.
// Used by the CDP harnesses so they never disturb the desktop.
const offscreen = Boolean(process.env.RELIQUARY_OFFSCREEN)

// Harness/test runs point userData at a scratch dir for deterministic state.
if (process.env.RELIQUARY_USER_DATA) {
  app.setPath('userData', process.env.RELIQUARY_USER_DATA)
}

/** Creates the main application window. */
function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'ReliquarySSH',
    backgroundColor: '#1c2128',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen,
      backgroundThrottling: !offscreen
    }
  })

  window.on('ready-to-show', () => {
    if (!offscreen) window.show()
  })

  // External links open in the system browser, never inside the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

app.whenReady().then(() => {
  // The log file lives next to the database in userData.
  logger.setFile(join(app.getPath('userData'), 'reliquary.log'))
  logger.info('ReliquarySSH is starting', {
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
    packaged: app.isPackaged
  })

  if (offscreen && process.platform === 'darwin') {
    // No Dock icon, no app activation — the harness stays invisible.
    app.dock?.hide()
  }
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Every uncaught error goes into the log — a crash must not be silent.
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error.stack ?? error.message)
})

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', reason instanceof Error ? reason.stack : String(reason))
})

// Close every live session exactly once before the process exits.
let quitting = false
app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  logger.info('ReliquarySSH is quitting')
  void sessionManager.disconnectAll().finally(() => app.quit())
})

// Hardened runtime: no remote module, context isolation stays on everywhere.
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS ??= 'false'
