import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '../data/settingsStorage'
import type { Product } from '../domain/types'
import { DEFAULT_LABEL_TEMPLATE, DEFAULT_POLONO_LABEL_TEMPLATE } from './labelTemplate'

vi.mock('./printerClient')
vi.mock('./browserLabelPrint')

import { sendToPrinter } from './printerClient'
import { printLabelViaBrowser } from './browserLabelPrint'
import { printProductLabel } from './printLabel'

const sendToPrinterMock = vi.mocked(sendToPrinter)
const printLabelViaBrowserMock = vi.mocked(printLabelViaBrowser)

const PRODUCT: Product = {
  id: 'p1',
  barcode: '',
  sku: 'SKU-001',
  name: 'Sample Product',
  category: '',
  location: '',
  variation: 'Blue',
  quantity: 1,
  reorderLevel: 0,
  cost: 1,
  price: 1,
  createdAt: 't',
  updatedAt: 't',
}

const baseSettings = (): Settings => ({
  saleChannels: [],
  printerKind: 'zebra',
  polonoPrintRotation: 'off',
  labelPresets: [],
  quickCodes: [],
  productCategories: [],
})

beforeEach(() => {
  sendToPrinterMock.mockReset().mockResolvedValue({ ok: true, value: true })
  printLabelViaBrowserMock.mockReset().mockReturnValue({ ok: true, value: true })
})

describe('printProductLabel', () => {
  it('sends a CPCL job over the network for the Zebra (the default) and never touches the browser print path', async () => {
    await printProductLabel(PRODUCT, baseSettings())

    expect(sendToPrinterMock).toHaveBeenCalledOnce()
    expect(printLabelViaBrowserMock).not.toHaveBeenCalled()
    // The CPCL body should reference the product's SKU somewhere in the TEXT/BARCODE commands.
    expect(sendToPrinterMock.mock.calls[0][0]).toContain('SKU-001')
  })

  it('routes to the browser print dialog for the Polono, and never sends a CPCL job', async () => {
    await printProductLabel(PRODUCT, { ...baseSettings(), printerKind: 'polono' })

    expect(printLabelViaBrowserMock).toHaveBeenCalledOnce()
    expect(sendToPrinterMock).not.toHaveBeenCalled()
    const [product, template] = printLabelViaBrowserMock.mock.calls[0]
    expect(product).toMatchObject({ name: 'Sample Product', sku: 'SKU-001', variation: 'Blue' })
    // No polonoLabelTemplate override was set, so it falls back to the Polono default.
    expect(template).toEqual(DEFAULT_POLONO_LABEL_TEMPLATE)
  })

  it('uses the saved Polono template override instead of the default when one exists', async () => {
    const polonoLabelTemplate = { ...DEFAULT_POLONO_LABEL_TEMPLATE, widthDots: 350 }

    await printProductLabel(PRODUCT, { ...baseSettings(), printerKind: 'polono', polonoLabelTemplate })

    const [, template] = printLabelViaBrowserMock.mock.calls[0]
    expect(template).toEqual(polonoLabelTemplate)
  })

  it('passes the saved Polono print rotation through to the browser print path', async () => {
    await printProductLabel(PRODUCT, { ...baseSettings(), printerKind: 'polono', polonoPrintRotation: 'cw' })

    const [, , , rotation] = printLabelViaBrowserMock.mock.calls[0]
    expect(rotation).toBe('cw')
  })

  it('uses the saved Zebra template override instead of the default when one exists', async () => {
    const labelTemplate = { ...DEFAULT_LABEL_TEMPLATE, widthDots: 700 }

    await printProductLabel(PRODUCT, { ...baseSettings(), labelTemplate })

    expect(sendToPrinterMock.mock.calls[0][0]).toBeDefined()
    // A wider label means a larger PAGE-WIDTH in the CPCL body.
    expect(sendToPrinterMock.mock.calls[0][0]).toContain('PAGE-WIDTH 700')
  })
})
