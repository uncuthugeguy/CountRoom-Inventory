export const SETTINGS_STORAGE_KEY = 'stockflow.settings.v1'

/** Offered on first run; the user can rename, remove or add to this freely. */
export const DEFAULT_SALE_CHANNELS = [
  'eBay',
  'Facebook Marketplace',
  'Vinted',
  'Depop',
  'Etsy',
  'In-person / Walk-in',
  'Website',
]

export interface Settings {
  /** Data URL of the uploaded logo, printed on labels when present. */
  logoDataUrl?: string
  /** Where a sale can be attributed to — user-managed, checkout offers these as quick picks. */
  saleChannels: string[]
}

const empty = (): Settings => ({ saleChannels: [...DEFAULT_SALE_CHANNELS] })

function read(storage: Storage): Settings {
  const raw = storage.getItem(SETTINGS_STORAGE_KEY)
  if (!raw) return empty()
  try {
    const parsed = JSON.parse(raw) as Partial<Settings>
    const logoDataUrl = typeof parsed.logoDataUrl === 'string' ? parsed.logoDataUrl : undefined
    const saleChannels =
      Array.isArray(parsed.saleChannels) && parsed.saleChannels.length > 0
        ? parsed.saleChannels.filter((value): value is string => typeof value === 'string')
        : [...DEFAULT_SALE_CHANNELS]
    return { ...(logoDataUrl ? { logoDataUrl } : {}), saleChannels }
  } catch {
    return empty()
  }
}

export interface SettingsStore {
  get(): Settings
  setLogo(dataUrl: string): void
  clearLogo(): void
  addChannel(name: string): void
  renameChannel(oldName: string, newName: string): void
  removeChannel(name: string): void
}

/** Thin localStorage-backed store, separate from the inventory repository since
 * the printed-label logo and sale channels are device/business preferences
 * rather than tenant catalogue data. */
export function createSettingsStore(storage: Storage = localStorage): SettingsStore {
  let state = read(storage)
  const persist = () => storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(state))

  return {
    get: () => ({ ...state, saleChannels: [...state.saleChannels] }),

    setLogo(dataUrl: string) {
      state = { ...state, logoDataUrl: dataUrl }
      persist()
    },

    clearLogo() {
      // Only drops the logo — the channel list is unrelated and must survive.
      const { logoDataUrl: _drop, ...rest } = state
      state = rest
      persist()
    },

    addChannel(name: string) {
      const trimmed = name.trim()
      if (!trimmed) return
      const exists = state.saleChannels.some((c) => c.toLowerCase() === trimmed.toLowerCase())
      if (exists) return
      state = { ...state, saleChannels: [...state.saleChannels, trimmed] }
      persist()
    },

    renameChannel(oldName: string, newName: string) {
      const trimmed = newName.trim()
      if (!trimmed) return
      state = {
        ...state,
        saleChannels: state.saleChannels.map((c) => (c === oldName ? trimmed : c)),
      }
      persist()
    },

    removeChannel(name: string) {
      state = { ...state, saleChannels: state.saleChannels.filter((c) => c !== name) }
      persist()
    },
  }
}
