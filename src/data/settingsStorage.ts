import { sanitiseLabelTemplate, type LabelPreset, type LabelTemplate } from '../printing/labelTemplate'

const newId = (): string =>
  typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `preset-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`

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
  /** Sizing and placement for printed product labels. Falls back to `DEFAULT_LABEL_TEMPLATE` when unset. */
  labelTemplate?: LabelTemplate
  /** Named, saved label layouts — e.g. "Shipping label", "RV" — that can be
   * loaded back over `labelTemplate` at any time. Saving one doesn't change
   * what currently prints; only loading one does. */
  labelPresets: LabelPreset[]
}

const empty = (): Settings => ({ saleChannels: [...DEFAULT_SALE_CHANNELS], labelPresets: [] })

const sanitisePresets = (value: unknown): LabelPreset[] => {
  if (!Array.isArray(value)) return []
  return value
    .filter((p): p is Partial<LabelPreset> => !!p && typeof p === 'object')
    .filter((p) => typeof p.id === 'string' && typeof p.name === 'string' && p.template)
    .map((p) => ({ id: p.id as string, name: p.name as string, template: sanitiseLabelTemplate(p.template) }))
}

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
    const labelTemplate =
      parsed.labelTemplate && typeof parsed.labelTemplate === 'object'
        ? sanitiseLabelTemplate(parsed.labelTemplate)
        : undefined
    const labelPresets = sanitisePresets(parsed.labelPresets)
    return {
      ...(logoDataUrl ? { logoDataUrl } : {}),
      saleChannels,
      ...(labelTemplate ? { labelTemplate } : {}),
      labelPresets,
    }
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
  setLabelTemplate(template: LabelTemplate): void
  resetLabelTemplate(): void
  /**
   * Saves the label template passed in as a named preset — a new one if no
   * existing preset has that name (case-insensitively), or overwriting the
   * matching one if one does. Does not change what's currently live/editing.
   */
  saveLabelPreset(name: string, template: LabelTemplate): void
  /** Copies a saved preset's layout over the live/editing template. */
  applyLabelPreset(id: string): void
  renameLabelPreset(id: string, newName: string): void
  deleteLabelPreset(id: string): void
  /**
   * Overwrites whichever fields are present with values pulled from another
   * source (the account's synced settings in Supabase mode) in one write,
   * rather than three separate setter calls each triggering their own
   * persist/render — see `useSettingsSync`.
   */
  applyRemote(remote: {
    logoDataUrl?: string
    labelTemplate?: LabelTemplate
    saleChannels?: string[]
    labelPresets?: LabelPreset[]
  }): void
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

    setLabelTemplate(template: LabelTemplate) {
      state = { ...state, labelTemplate: sanitiseLabelTemplate(template) }
      persist()
    },

    resetLabelTemplate() {
      // Only drops the override — the logo and channels are unrelated and must survive.
      const { labelTemplate: _drop, ...rest } = state
      state = rest
      persist()
    },

    saveLabelPreset(name: string, template: LabelTemplate) {
      const trimmed = name.trim()
      if (!trimmed) return
      const sanitised = sanitiseLabelTemplate(template)
      const existing = state.labelPresets.find((p) => p.name.toLowerCase() === trimmed.toLowerCase())
      const labelPresets = existing
        ? state.labelPresets.map((p) => (p.id === existing.id ? { ...p, template: sanitised } : p))
        : [...state.labelPresets, { id: newId(), name: trimmed, template: sanitised }]
      state = { ...state, labelPresets }
      persist()
    },

    applyLabelPreset(id: string) {
      const preset = state.labelPresets.find((p) => p.id === id)
      if (!preset) return
      state = { ...state, labelTemplate: sanitiseLabelTemplate(preset.template) }
      persist()
    },

    renameLabelPreset(id: string, newName: string) {
      const trimmed = newName.trim()
      if (!trimmed) return
      state = {
        ...state,
        labelPresets: state.labelPresets.map((p) => (p.id === id ? { ...p, name: trimmed } : p)),
      }
      persist()
    },

    deleteLabelPreset(id: string) {
      state = { ...state, labelPresets: state.labelPresets.filter((p) => p.id !== id) }
      persist()
    },

    applyRemote(remote) {
      state = {
        ...state,
        ...(remote.logoDataUrl !== undefined ? { logoDataUrl: remote.logoDataUrl } : {}),
        ...(remote.saleChannels !== undefined ? { saleChannels: [...remote.saleChannels] } : {}),
        ...(remote.labelTemplate !== undefined ? { labelTemplate: sanitiseLabelTemplate(remote.labelTemplate) } : {}),
        ...(remote.labelPresets !== undefined ? { labelPresets: sanitisePresets(remote.labelPresets) } : {}),
      }
      persist()
    },
  }
}
