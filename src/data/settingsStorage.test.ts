import { beforeEach, describe, expect, it } from 'vitest'
import { createSettingsStore, DEFAULT_SALE_CHANNELS, SETTINGS_STORAGE_KEY } from './settingsStorage'
import { DEFAULT_LABEL_TEMPLATE } from '../printing/labelTemplate'
import { memoryStorage } from '../test/memoryStorage'

let storage: Storage

beforeEach(() => {
  storage = memoryStorage()
})

describe('createSettingsStore', () => {
  it('starts with no logo and the default sale channels', () => {
    expect(createSettingsStore(storage).get()).toEqual({
      saleChannels: DEFAULT_SALE_CHANNELS,
      labelPresets: [],
      quickCodes: [],
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
    expect(createSettingsStore(storage).get()).toEqual({ saleChannels: DEFAULT_SALE_CHANNELS, labelPresets: [], quickCodes: [] })
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
