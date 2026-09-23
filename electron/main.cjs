// Electron main process — wraps the same web app in a native window for
// Mac and Windows. Written as .cjs (not .js) because package.json sets
// "type": "module" for the Vite/React side, and Electron's main process
// still expects CommonJS by default.
const { app, BrowserWindow, ipcMain, shell } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
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
      // Only exposes window.countroomPrinting (list printers / print a label).
      preload: path.join(__dirname, 'preload.cjs'),
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

// ---------------------------------------------------------------------------
// Label printing (Polono). The web app renders each label as a PNG at the
// printer's exact 203 dpi and hands it over here; this prints it at the
// label's true physical size with no margins, silently when a printer name
// is given. See src/printing/labelPrint.ts.
// ---------------------------------------------------------------------------

ipcMain.handle('labels:list-printers', async (event) => {
  const printers = await event.sender.getPrintersAsync()
  return printers.map((p) => ({
    name: p.name,
    displayName: p.displayName || p.name,
    isDefault: Boolean(p.isDefault),
  }))
})

const inRange = (n, min, max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max

ipcMain.handle('labels:print-image', async (_event, job) => {
  if (!job || typeof job.dataUrl !== 'string' || !job.dataUrl.startsWith('data:image/png;base64,')) {
    return { ok: false, error: 'Invalid label image.' }
  }
  if (!inRange(job.widthMicrons, 5000, 300000) || !inRange(job.heightMicrons, 5000, 300000)) {
    return { ok: false, error: 'Invalid label size.' }
  }
  const copies = inRange(job.copies, 1, 500) ? Math.round(job.copies) : 1
  const deviceName = typeof job.deviceName === 'string' && job.deviceName ? job.deviceName : undefined

  const wIn = job.widthMicrons / 25400
  const hIn = job.heightMicrons / 25400
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: ${wIn}in ${hIn}in; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
img { display: block; width: ${wIn}in; height: ${hIn}in; image-rendering: pixelated; }
</style></head><body><img src="${job.dataUrl}"></body></html>`

  const file = path.join(os.tmpdir(), `countroom-label-${process.pid}-${Date.now()}.html`)
  fs.writeFileSync(file, html)

  const printWin = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  try {
    await printWin.loadFile(file)
    await printWin.webContents.executeJavaScript(
      'Promise.all(Array.from(document.images).map((i) => i.decode().catch(() => {}))).then(() => true)',
    )
    return await new Promise((resolve) => {
      printWin.webContents.print(
        {
          silent: Boolean(deviceName),
          ...(deviceName ? { deviceName } : {}),
          printBackground: true,
          color: false,
          copies,
          margins: { marginType: 'none' },
          pageSize: { width: Math.round(job.widthMicrons), height: Math.round(job.heightMicrons) },
        },
        (success, failureReason) => {
          if (success) resolve({ ok: true })
          else if (failureReason === 'cancelled') resolve({ ok: false, error: 'Printing cancelled.' })
          else resolve({ ok: false, error: failureReason || 'The printer refused the job.' })
        },
      )
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    printWin.destroy()
    fs.rm(file, { force: true }, () => {})
  }
})

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
