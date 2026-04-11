import { app, BrowserWindow } from 'electron'
import path from 'path'
import { initDb } from './db'
import { registerIpcHandlers } from './ipcHandlers'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  const dbPath = path.join(app.getPath('userData'), 'windows.db')
  initDb(dbPath)

  const win = createWindow()
  registerIpcHandlers(win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const newWin = createWindow()
      registerIpcHandlers(newWin)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
