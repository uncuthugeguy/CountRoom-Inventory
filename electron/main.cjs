// Electron main process — wraps the same web app in a native window for
// Mac and Windows. Written as .cjs (not .js) because package.json sets
// "type": "module" for the Vite/React side, and Electron's main process
// still expects CommonJS by default.
const { app, BrowserWindow, shell } = require('electron')
const path = require('node:path')

// Sends any link the app tries to open in a new window (e.g. an external
// URL from an <a target="_blank">) to the user's real browser instead of
// opening a second Electron window — desktop apps shouldn't be a browser.
function attachExternalLinkHandler(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#211d19',
    title: 'CountRoom Inventory',
    webPreferences: {
      // Nothing in the renderer needs Node access — it's the same web app
      // that already runs in a regular browser tab, just in its own window.
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  attachExternalLinkHandler(win)

  // In dev, point at the Vite dev server so changes hot-reload like normal;
  // in a packaged build, load the built dist/ files straight off disk.
  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    win.loadURL(devServerUrl)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
