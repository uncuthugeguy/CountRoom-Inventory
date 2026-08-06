import { beforeEach, describe, expect, it } from 'vitest'
import { createSettingsStore, DEFAULT_SALE_CHANNELS, SETTINGS_STORAGE_KEY } from './settingsStorage'
import { memoryStorage } from '../test/memoryStorage'

let storage: Storage

beforeEach(() => {
  storage = memoryStorage()
})

describe('createSettingsStore', () => {
  it('starts with no logo and the default sale channels', () => {
    expect(createSettingsStore(storage).get()).toEqual({
      saleChannels: DEFAULT_SALE_CHANNELS,
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
    expect(createSettingsStore(storage).get()).toEqual({ saleChannels: DEFAULT_SALE_CHANNELS })
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
