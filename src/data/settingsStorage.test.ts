import { beforeEach, describe, expect, it } from 'vitest'
import { createSettingsStore, DEFAULT_SALE_CHANNELS, SETTINGS_STORAGE_KEY } from './settingsStorage'
import { DEFAULT_BARCODE_LABEL_LAYOUT } from '../printing/barcodeLabelLayout'
import { DEFAULT_LABEL_PRINTER_SETTINGS } from '../printing/labelPrinterSettings'
import { memoryStorage } from '../test/memoryStorage'

let storage: Storage

beforeEach(() => {
  storage = memoryStorage()
})

describe('createSettingsStore', () => {
  it('starts with no logo, the default sale channels and default printer settings', () => {
    expect(createSettingsStore(storage).get()).toEqual({
      saleChannels: DEFAULT_SALE_CHANNELS,
      labelPrinter: DEFAULT_LABEL_PRINTER_SETTINGS,
      quickCodes: [],
      productCategories: [],
    })
  })

  it('persists an uploaded logo and reloads it in a new instance', () => {
    const store = createSettingsStore(storage)
    store.setLogo('data:image/png;base64,AAA')
    expect(storage.getItem(SETTINGS_STORAGE_KEY)).toContain('AAA')

    const reopened = createSettingsStore(storage)
    expect(reopened.get().logoDataUrl).toBe('data:image/png;base64,AAA')
  })

  it('clears the logo without touching the sale channels', () => {
    const store = createSettingsStore(storage)
    store.setLogo('data:image/png;base64,AAA')
    store.addChannel('Custom Market')
    store.clearLogo()
    expect(store.get().logoDataUrl).toBeUndefined()
    expect(store.get().saleChannels).toContain('Custom Market')
  })

  it('recovers from corrupt storage instead of throwing', () => {
    storage.setItem(SETTINGS_STORAGE_KEY, 'not json{{')
    expect(createSettingsStore(storage).get()).toEqual({
      saleChannels: DEFAULT_SALE_CHANNELS,
      labelPrinter: DEFAULT_LABEL_PRINTER_SETTINGS,
      quickCodes: [],
      productCategories: [],
    })
  })
})

describe('sale channels', () => {
  it('adds a new channel and persists it', () => {
    const store = createSettingsStore(storage)
    store.addChannel('Car Boot Sale')
    expect(store.get().saleChannels).toContain('Car Boot Sale')

    const reopened = createSettingsStore(storage)
    expect(reopened.get().saleChannels).toContain('Car Boot Sale')
  })

  it('trims whitespace and ignores a blank name', () => {
    const store = createSettingsStore(storage)
    store.addChannel('   ')
    expect(store.get().saleChannels).toEqual(DEFAULT_SALE_CHANNELS)

    store.addChannel('  Car Boot Sale  ')
    expect(store.get().saleChannels).toContain('Car Boot Sale')
  })

  it('does not add a duplicate channel, case-insensitively', () => {
    const store = createSettingsStore(storage)
    store.addChannel('ebay')
    expect(store.get().saleChannels.filter((c) => c.toLowerCase() === 'ebay')).toHaveLength(1)
  })

  it('renames a channel', () => {
    const store = createSettingsStore(storage)
    store.renameChannel('Etsy', 'Etsy UK')
    expect(store.get().saleChannels).toContain('Etsy UK')
    expect(store.get().saleChannels).not.toContain('Etsy')
  })

  it('removes a channel', () => {
    const store = createSettingsStore(storage)
    store.removeChannel('Depop')
    expect(store.get().saleChannels).not.toContain('Depop')
  })
})

describe('product categories', () => {
  it('starts empty', () => {
    const store = createSettingsStore(storage)
    expect(store.get().productCategories).toEqual([])
  })

  it('adds a new category and persists it', () => {
    const store = createSettingsStore(storage)
    store.addProductCategory('Hand Tools')
    expect(store.get().productCategories).toContain('Hand Tools')

    const reopened = createSettingsStore(storage)
    expect(reopened.get().productCategories).toContain('Hand Tools')
  })

  it('trims whitespace and ignores a blank name', () => {
    const store = createSettingsStore(storage)
    store.addProductCategory('   ')
    expect(store.get().productCategories).toEqual([])

    store.addProductCategory('  Hand Tools  ')
    expect(store.get().productCategories).toContain('Hand Tools')
  })

  it('does not add a duplicate category, case-insensitively', () => {
    const store = createSettingsStore(storage)
    store.addProductCategory('Fasteners')
    store.addProductCategory('fasteners')
    expect(store.get().productCategories.filter((c) => c.toLowerCase() === 'fasteners')).toHaveLength(1)
  })

  it('renames a category', () => {
    const store = createSettingsStore(storage)
    store.addProductCategory('Power Tools')
    store.renameProductCategory('Power Tools', 'Power Tools & Batteries')
    expect(store.get().productCategories).toContain('Power Tools & Batteries')
    expect(store.get().productCategories).not.toContain('Power Tools')
  })

  it('removes a category', () => {
    const store = createSettingsStore(storage)
    store.addProductCategory('Consumables')
    store.removeProductCategory('Consumables')
    expect(store.get().productCategories).not.toContain('Consumables')
  })
})

describe('barcode label layout', () => {
  it('has no override until one is set, so callers fall back to the default layout', () => {
    expect(createSettingsStore(storage).get().barcodeLabelLayout).toBeUndefined()
  })

  it('saves a layout, clamping boxes onto the label, and persists it', () => {
    const store = createSettingsStore(storage)
    store.setBarcodeLabelLayout({ ...DEFAULT_BARCODE_LABEL_LAYOUT, name: { ...DEFAULT_BARCODE_LABEL_LAYOUT.name, x: 9999 } })
    const saved = createSettingsStore(storage).get().barcodeLabelLayout
    expect(saved?.version).toBe(2)
    expect(saved!.name.x + saved!.name.w).toBeLessThanOrEqual(406)
  })

  it('resets back to no override', () => {
    const store = createSettingsStore(storage)
    store.setBarcodeLabelLayout(DEFAULT_BARCODE_LABEL_LAYOUT)
    store.resetBarcodeLabelLayout()
    expect(store.get().barcodeLabelLayout).toBeUndefined()
  })

  it('drops old Zebra-era label settings from storage instead of crashing on them', () => {
    storage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ printerKind: 'zebra', labelTemplate: { widthDots: 609 }, polonoPrintRotation: 'cw', labelPresets: [] }),
    )
    const settings = createSettingsStore(storage).get()
    expect(settings).not.toHaveProperty('printerKind')
    expect(settings).not.toHaveProperty('labelTemplate')
    expect(settings.barcodeLabelLayout).toBeUndefined()
  })

  it('ignores an old-format template arriving from the account sync', () => {
    const store = createSettingsStore(storage)
    store.applyRemote({ barcodeLabelLayout: { widthDots: 609 } as never })
    expect(store.get().barcodeLabelLayout).toBeUndefined()
  })

  it('accepts a new-format layout from the account sync', () => {
    const store = createSettingsStore(storage)
    store.applyRemote({ barcodeLabelLayout: DEFAULT_BARCODE_LABEL_LAYOUT })
    expect(store.get().barcodeLabelLayout).toEqual(DEFAULT_BARCODE_LABEL_LAYOUT)
  })
})

describe('label printer settings', () => {
  it('stores the printer name and per-size calibration, clamping offsets', () => {
    const store = createSettingsStore(storage)
    store.setLabelPrinter({
      printerName: 'POLONO PL60',
      headWidthIn: 4.25,
      calibration: {
        '2x1': { leftDots: 150, offsetY: -3, rotation: 180 },
        '4x6': { leftDots: -20, offsetY: 5000, rotation: 45 as never },
      },
    })
    const printer = createSettingsStore(storage).get().labelPrinter
    expect(printer.printerName).toBe('POLONO PL60')
    expect(printer.headWidthIn).toBe(4.25)
    expect(printer.calibration['2x1']).toEqual({ leftDots: 150, offsetY: -3, rotation: 180 })
    expect(printer.calibration['4x6']).toEqual({ leftDots: 0, offsetY: 100, rotation: 0 })
  })

  it('drops the old left/right shift and defaults to a 4 in head with the label centred', () => {
    storage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ labelPrinter: { calibration: { '2x1': { offsetX: 40, offsetY: 2, rotation: 0 } } } }),
    )
    const printer = createSettingsStore(storage).get().labelPrinter
    expect(printer.headWidthIn).toBe(4)
    expect(printer.calibration['2x1']).toEqual({ leftDots: null, offsetY: 2, rotation: 0 })
  })
})

describe('quick codes', () => {
  it('adds a code and persists it', () => {
    const store = createSettingsStore(storage)
    const id = store.addQuickCode({ category: 'Printer codes', name: 'Restore defaults', value: 'ZEBRA-RESTORE', format: 'qr' })

    expect(store.get().quickCodes).toHaveLength(1)
    expect(store.get().quickCodes[0]).toMatchObject({ id, category: 'Printer codes', name: 'Restore defaults', value: 'ZEBRA-RESTORE' })

    const reopened = createSettingsStore(storage)
    expect(reopened.get().quickCodes).toHaveLength(1)
  })

  it('falls back to "Other" for a blank category', () => {
    const store = createSettingsStore(storage)
    store.addQuickCode({ category: '', name: 'Guest Wi-Fi', value: 'WIFI:S:Guest;;', format: 'qr' })
    expect(store.get().quickCodes[0].category).toBe('Other')
  })

  it('updates a code in place', () => {
    const store = createSettingsStore(storage)
    const id = store.addQuickCode({ category: 'Printer codes', name: 'Battery', value: 'OLD', format: 'qr' })

    store.updateQuickCode(id, { value: 'NEW', note: 'Hold 3s' })

    expect(store.get().quickCodes[0]).toMatchObject({ id, value: 'NEW', note: 'Hold 3s', name: 'Battery' })
  })

  it('deletes a code', () => {
    const store = createSettingsStore(storage)
    const id = store.addQuickCode({ category: 'Other', name: 'Test', value: 'X', format: 'qr' })

    store.deleteQuickCode(id)

    expect(store.get().quickCodes).toEqual([])
  })

  it('drops a saved code that is missing required fields instead of crashing on read', () => {
    storage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ saleChannels: DEFAULT_SALE_CHANNELS, quickCodes: [{ id: '1' }, { id: '2', name: 'Ok', value: 'V' }] }),
    )
    const store = createSettingsStore(storage)
    expect(store.get().quickCodes).toEqual([{ id: '2', name: 'Ok', value: 'V', category: 'Other', format: 'qr' }])
  })
})
