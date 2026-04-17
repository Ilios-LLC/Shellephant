import { app, BrowserWindow } from 'electron'
import path from 'path'
import { initDb } from './db'
import { registerIpcHandlers } from './ipcHandlers'
import { reconcileWindows } from './windowService'
import { startWaitingPoller } from './waitingPoller'
import { getGitHubPat } from './settingsService'
import { getIdentity } from './githubIdentity'
import { applyGitIdentity } from './gitOps'

if (process.env['DEVCONTAINER']) {
  app.commandLine.appendSwitch('no-sandbox')
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(async () => {
  const dbPath = path.join(app.getPath('userData'), 'windows.db')
  initDb(dbPath)
  startWaitingPoller()

  try {
    await reconcileWindows()
  } catch (err) {
    console.error('reconcileWindows failed; continuing with unknown statuses', err)
  }

  const pat = getGitHubPat()
  if (pat) {
    getIdentity(pat)
      .then(({ name, email }) => applyGitIdentity(name, email))
      .catch((err) => console.error('Failed to apply git identity on startup:', err))
  }

  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
