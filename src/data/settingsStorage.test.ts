import { beforeEach, describe, expect, it } from 'vitest'
import { createSettingsStore, DEFAULT_SALE_CHANNELS, SETTINGS_STORAGE_KEY } from './settingsStorage'
import { DEFAULT_LABEL_TEMPLATE, DEFAULT_POLONO_LABEL_TEMPLATE } from '../printing/labelTemplate'
import { memoryStorage } from '../test/memoryStorage'

let storage: Storage

beforeEach(() => {
  storage = memoryStorage()
})

describe('createSettingsStore', () => {
  it('starts with no logo, the default sale channels, and the Zebra as the selected printer', () => {
    expect(createSettingsStore(storage).get()).toEqual({
      saleChannels: DEFAULT_SALE_CHANNELS,
      printerKind: 'zebra',
      polonoPrintRotation: 'off',
      labelPresets: [],
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
      printerKind: 'zebra',
      polonoPrintRotation: 'off',
      labelPresets: [],
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

describe('printer selection', () => {
  it('defaults to the Zebra', () => {
    const store = createSettingsStore(storage)
    expect(store.get().printerKind).toBe('zebra')
  })

  it('switches to the Polono and persists the choice across a reload', () => {
    const store = createSettingsStore(storage)
    store.setPrinterKind('polono')
    expect(store.get().printerKind).toBe('polono')

    const reopened = createSettingsStore(storage)
    expect(reopened.get().printerKind).toBe('polono')
  })

  it('ignores an invalid stored value and falls back to the Zebra rather than crashing', () => {
    storage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ saleChannels: DEFAULT_SALE_CHANNELS, printerKind: 'inkjet', labelPresets: [], quickCodes: [] }),
    )
    expect(createSettingsStore(storage).get().printerKind).toBe('zebra')
  })
})

describe('Polono print rotation', () => {
  it('defaults to off', () => {
    const store = createSettingsStore(storage)
    expect(store.get().polonoPrintRotation).toBe('off')
  })

  it('sets and persists a rotation direction across a reload', () => {
    const store = createSettingsStore(storage)
    store.setPolonoPrintRotation('cw')
    expect(store.get().polonoPrintRotation).toBe('cw')

    const reopened = createSettingsStore(storage)
    expect(reopened.get().polonoPrintRotation).toBe('cw')
  })

  it('ignores an invalid stored value and falls back to off rather than crashing', () => {
    storage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ saleChannels: DEFAULT_SALE_CHANNELS, polonoPrintRotation: 'sideways', labelPresets: [], quickCodes: [] }),
    )
    expect(createSettingsStore(storage).get().polonoPrintRotation).toBe('off')
  })
})

describe('Polono label template', () => {
  it('has no override until one is set, so callers fall back to DEFAULT_POLONO_LABEL_TEMPLATE', () => {
    const store = createSettingsStore(storage)
    expect(store.get().polonoLabelTemplate).toBeUndefined()
  })

  it('is stored separately from the Zebra template — setting one leaves the other untouched', () => {
    const store = createSettingsStore(storage)
    store.setLabelTemplate({ ...DEFAULT_LABEL_TEMPLATE, widthDots: 500 })
    store.setPolonoLabelTemplate({ ...DEFAULT_POLONO_LABEL_TEMPLATE, widthDots: 350 })

    expect(store.get().labelTemplate?.widthDots).toBe(500)
    expect(store.get().polonoLabelTemplate?.widthDots).toBe(350)
  })

  it('clamps an out-of-range Polono template using the Polono defaults, not the Zebra ones', () => {
    const store = createSettingsStore(storage)
    store.setPolonoLabelTemplate({ ...DEFAULT_POLONO_LABEL_TEMPLATE, dpi: 99999, nameFont: -5 })

    const saved = store.get().polonoLabelTemplate
    expect(saved?.dpi).toBeLessThanOrEqual(600)
    expect(saved?.nameFont).toBeGreaterThanOrEqual(0)
    // Untouched fields keep the Polono default's own values, not the Zebra's.
    expect(saved?.widthDots).toBe(DEFAULT_POLONO_LABEL_TEMPLATE.widthDots)
  })

  it('resets the Polono override without touching the Zebra template', () => {
    const store = createSettingsStore(storage)
    store.setLabelTemplate({ ...DEFAULT_LABEL_TEMPLATE, widthDots: 500 })
    store.setPolonoLabelTemplate({ ...DEFAULT_POLONO_LABEL_TEMPLATE, widthDots: 350 })

    store.resetPolonoLabelTemplate()

    expect(store.get().polonoLabelTemplate).toBeUndefined()
    expect(store.get().labelTemplate?.widthDots).toBe(500)
  })

  it('persists across a reload', () => {
    const store = createSettingsStore(storage)
    store.setPolonoLabelTemplate({ ...DEFAULT_POLONO_LABEL_TEMPLATE, widthDots: 350 })

    const reopened = createSettingsStore(storage)
    expect(reopened.get().polonoLabelTemplate?.widthDots).toBe(350)
  })
})

describe('label presets', () => {
  it('saves the given template as a new named preset without touching the live template', () => {
    const store = createSettingsStore(storage)
    store.setLabelTemplate({ ...DEFAULT_LABEL_TEMPLATE, widthDots: 400 })
    store.saveLabelPreset('Shipping label', { ...DEFAULT_LABEL_TEMPLATE, widthDots: 999 })

    expect(store.get().labelPresets).toHaveLength(1)
    expect(store.get().labelPresets[0]).toMatchObject({ name: 'Shipping label' })
    expect(store.get().labelPresets[0].template.widthDots).toBe(999)
    expect(store.get().labelTemplate?.widthDots).toBe(400) // unchanged by saving
  })

  it('overwrites an existing preset with the same name, case-insensitively, instead of duplicating it', () => {
    const store = createSettingsStore(storage)
    store.saveLabelPreset('Shipping label', { ...DEFAULT_LABEL_TEMPLATE, widthDots: 100 })
    store.saveLabelPreset('SHIPPING LABEL', { ...DEFAULT_LABEL_TEMPLATE, widthDots: 200 })

    expect(store.get().labelPresets).toHaveLength(1)
    expect(store.get().labelPresets[0].template.widthDots).toBe(200)
  })

  it('loads a preset over the live template', () => {
    const store = createSettingsStore(storage)
    store.saveLabelPreset('RV', { ...DEFAULT_LABEL_TEMPLATE, widthDots: 777 })
    const id = store.get().labelPresets[0].id

    store.setLabelTemplate({ ...DEFAULT_LABEL_TEMPLATE, widthDots: 1 })
    store.applyLabelPreset(id)

    expect(store.get().labelTemplate?.widthDots).toBe(777)
  })

  it('renames a preset', () => {
    const store = createSettingsStore(storage)
    store.saveLabelPreset('RV', DEFAULT_LABEL_TEMPLATE)
    const id = store.get().labelPresets[0].id

    store.renameLabelPreset(id, 'Caravan')
    expect(store.get().labelPresets[0].name).toBe('Caravan')
  })

  it('deletes a preset', () => {
    const store = createSettingsStore(storage)
    store.saveLabelPreset('RV', DEFAULT_LABEL_TEMPLATE)
    const id = store.get().labelPresets[0].id

    store.deleteLabelPreset(id)
    expect(store.get().labelPresets).toEqual([])
  })

  it('ignores a blank preset name', () => {
    const store = createSettingsStore(storage)
    store.saveLabelPreset('   ', DEFAULT_LABEL_TEMPLATE)
    expect(store.get().labelPresets).toEqual([])
  })

  it('persists presets across a reload', () => {
    const store = createSettingsStore(storage)
    store.saveLabelPreset('RV', DEFAULT_LABEL_TEMPLATE)

    const reopened = createSettingsStore(storage)
    expect(reopened.get().labelPresets).toHaveLength(1)
    expect(reopened.get().labelPresets[0].name).toBe('RV')
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
      JSON.stringify({ saleChannels: DEFAULT_SALE_CHANNELS, labelPresets: [], quickCodes: [{ id: '1' }, { id: '2', name: 'Ok', value: 'V' }] }),
    )
    const store = createSettingsStore(storage)
    expect(store.get().quickCodes).toEqual([{ id: '2', name: 'Ok', value: 'V', category: 'Other', format: 'qr' }])
  })
})
