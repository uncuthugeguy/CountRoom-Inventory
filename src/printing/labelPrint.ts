import type { Result } from '../domain/types'
import type { PrintPage } from './labelRaster'

/**
 * Sends a finished label bitmap to the Polono.
 *
 * Two routes, picked automatically:
 *
 * - **Desktop app (Electron)**: the page goes straight to the printer through
 *   Electron's own print API with the exact label size in microns and no
 *   margins. With a printer chosen in Labels › Printer setup it prints
 *   silently — no dialog, no chance of the driver picking the wrong paper
 *   size or "fit to page" scaling.
 * - **Browser / PWA / phone**: a hidden iframe holding only the label, with
 *   `@page` set to the label's physical size, is printed through the normal
 *   print dialog. Choose the Polono, paper size matching the label, scale
 *   100% and margins None the first time — browsers remember it.
 */

export interface LabelPrinterInfo {
  name: string
  displayName: string
  isDefault: boolean
}

export interface ElectronPrintJob {
  dataUrl: string
  widthMicrons: number
  heightMicrons: number
  copies: number
  deviceName?: string
}

export interface CountroomPrintingBridge {
  listPrinters(): Promise<LabelPrinterInfo[]>
  printImage(job: ElectronPrintJob): Promise<{ ok: boolean; error?: string }>
}

declare global {
  interface Window {
    countroomPrinting?: CountroomPrintingBridge
  }
}

export const desktopPrinting = (): CountroomPrintingBridge | undefined =>
  typeof window !== 'undefined' ? window.countroomPrinting : undefined

export const hasDesktopPrinting = (): boolean => !!desktopPrinting()

const MICRONS_PER_INCH = 25_400

export interface PrintOptions {
  copies?: number
  /** Desktop app only: the system printer name to print to without a dialog. */
  printerName?: string
}

export async function printLabelPage(page: PrintPage, options: PrintOptions = {}): Promise<Result<true>> {
  const copies = Math.max(1, Math.min(500, Math.round(options.copies ?? 1)))
  const dataUrl = page.canvas.toDataURL('image/png')

  const bridge = desktopPrinting()
  if (bridge) {
    try {
      const result = await bridge.printImage({
        dataUrl,
        widthMicrons: Math.round(page.widthIn * MICRONS_PER_INCH),
        heightMicrons: Math.round(page.heightIn * MICRONS_PER_INCH),
        copies,
        ...(options.printerName ? { deviceName: options.printerName } : {}),
      })
      return result.ok ? { ok: true, value: true } : { ok: false, error: result.error ?? 'The printer refused the job.' }
    } catch (cause) {
      return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
    }
  }

  return printViaIframe(dataUrl, page.widthIn, page.heightIn, copies)
}

/** Builds the tiny print document — exported for tests. */
export function buildPrintDocument(dataUrl: string, widthIn: number, heightIn: number, copies: number): string {
  const page = `<div class="page"><img src="${dataUrl}" alt=""></div>`
  return `<!doctype html><html><head><meta charset="utf-8"><title>Label</title><style>
@page { size: ${widthIn}in ${heightIn}in; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
.page { width: ${widthIn}in; height: ${heightIn}in; overflow: hidden; break-after: page; page-break-after: always; }
.page:last-child { break-after: auto; page-break-after: auto; }
img { display: block; width: ${widthIn}in; height: ${heightIn}in; image-rendering: pixelated; image-rendering: crisp-edges; }
</style></head><body>${page.repeat(copies)}</body></html>`
}

const FRAME_ID = 'countroom-label-print-frame'

function printViaIframe(dataUrl: string, widthIn: number, heightIn: number, copies: number): Promise<Result<true>> {
  if (typeof document === 'undefined') return Promise.resolve({ ok: false, error: 'Printing needs a browser window.' })
  document.querySelectorAll(`#${FRAME_ID}`).forEach((el) => el.remove())

  const frame = document.createElement('iframe')
  frame.id = FRAME_ID
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  // Not display:none — some browsers refuse to print an undisplayed frame.
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;'

  return new Promise((resolve) => {
    let done = false
    const cleanup = () => setTimeout(() => frame.remove(), 1000)
    frame.onload = async () => {
      if (done) return
      done = true
      const win = frame.contentWindow
      const doc = frame.contentDocument
      if (!win || !doc) {
        frame.remove()
        resolve({ ok: false, error: 'Could not open the print preview.' })
        return
      }
      try {
        await Promise.all(
          Array.from(doc.images).map((img) => (img.decode ? img.decode().catch(() => undefined) : undefined)),
        )
        win.addEventListener('afterprint', cleanup)
        setTimeout(() => frame.remove(), 120_000)
        win.focus()
        win.print()
        resolve({ ok: true, value: true })
      } catch (cause) {
        frame.remove()
        resolve({ ok: false, error: cause instanceof Error ? cause.message : String(cause) })
      }
    }
    frame.srcdoc = buildPrintDocument(dataUrl, widthIn, heightIn, copies)
    document.body.appendChild(frame)
  })
}
