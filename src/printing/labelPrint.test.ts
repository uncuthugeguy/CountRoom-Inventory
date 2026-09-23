import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildPrintDocument, printLabelPage } from './labelPrint'
import type { PrintPage } from './labelRaster'

const fakePage = (widthIn: number, heightIn: number): PrintPage => ({
  canvas: { toDataURL: () => 'data:image/png;base64,AAAA' } as unknown as HTMLCanvasElement,
  widthIn,
  heightIn,
})

afterEach(() => {
  delete window.countroomPrinting
})

describe('buildPrintDocument', () => {
  it('sets the page to the label’s physical size with no margins', () => {
    const html = buildPrintDocument('data:x', 2, 1, 1)
    expect(html).toContain('@page { size: 2in 1in; margin: 0; }')
    expect(html.match(/<img /g)).toHaveLength(1)
  })

  it('repeats the label once per copy', () => {
    expect(buildPrintDocument('data:x', 4, 6, 3).match(/<img /g)).toHaveLength(3)
  })
})

describe('printLabelPage', () => {
  it('uses the desktop app’s silent print with the exact size in microns', async () => {
    const printImage = vi.fn().mockResolvedValue({ ok: true })
    window.countroomPrinting = { listPrinters: vi.fn(), printImage }
    const result = await printLabelPage(fakePage(4, 6), { copies: 2, printerName: 'POLONO PL60' })
    expect(result.ok).toBe(true)
    expect(printImage).toHaveBeenCalledWith({
      dataUrl: 'data:image/png;base64,AAAA',
      widthMicrons: 101600,
      heightMicrons: 152400,
      copies: 2,
      deviceName: 'POLONO PL60',
    })
  })

  it('passes a desktop print failure back as an error', async () => {
    window.countroomPrinting = { listPrinters: vi.fn(), printImage: vi.fn().mockResolvedValue({ ok: false, error: 'Out of labels' }) }
    expect(await printLabelPage(fakePage(2, 1))).toEqual({ ok: false, error: 'Out of labels' })
  })
})
