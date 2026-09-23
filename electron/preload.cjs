// Exposes a tiny, fixed printing API to the web app when it runs inside the
// desktop (Electron) wrapper. The page never gets Node or ipc access itself —
// only these two calls. See src/printing/labelPrint.ts for the web side.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('countroomPrinting', {
  listPrinters: () => ipcRenderer.invoke('labels:list-printers'),
  printImage: (job) => ipcRenderer.invoke('labels:print-image', job),
})
