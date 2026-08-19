import { sanitiseQuickCodes, type QuickCode, type QuickCodeDraft } from '../domain/quickCodes'
import {
  sanitiseLabelTemplate,
  sanitisePolonoLabelTemplate,
  type LabelPreset,
  type LabelTemplate,
  type PrinterKind,
} from '../printing/labelTemplate'

const newId = (prefix = 'preset'): string =>
  typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${prefix}-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`

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
  /**
   * Which printer `printProductLabel` sends to — defaults to `'zebra'` so
   * existing setups keep working exactly as before. Deliberately NOT part of
   * the account-wide sync (`AccountSettingsSync`/`applyRemote` below) the
   * way `labelTemplate`/`logoDataUrl` are: it describes which physical
   * printer is wired to *this* device, not shared business branding, so a
   * different machine signing into the same account shouldn't inherit it.
   */
  printerKind: PrinterKind
  /** Sizing and placement for labels printed to the Zebra. Falls back to `DEFAULT_LABEL_TEMPLATE` when unset. */
  labelTemplate?: LabelTemplate
  /** Sizing and placement for labels printed to the Polono — a separate
   * template from `labelTemplate` since the two printers are physically
   * different sizes/resolutions. Falls back to `DEFAULT_POLONO_LABEL_TEMPLATE`
   * when unset. Local-only, same reasoning as `printerKind` above. */
  polonoLabelTemplate?: LabelTemplate
  /** Named, saved label layouts — e.g. "Shipping label", "RV" — that can be
   * loaded back over `labelTemplate` at any time. Saving one doesn't change
   * what currently prints; only loading one does. Zebra-only for now — see
   * `LabelPresetsPanel` in `LabelTemplateEditor.tsx`. */
  labelPresets: LabelPreset[]
  /** Saved reference codes (printer maintenance commands, Wi-Fi joins,
   * supplier links, etc.) shown on screen for scanning instead of a paper
   * manual — see `domain/quickCodes.ts`. */
  quickCodes: QuickCode[]
  /**
   * Manager-curated list of product categories, offered as a dropdown on
   * the product form (see `ProductFormDialog`) instead of free text — only
   * a manager can add, rename or remove an entry (`SettingsScreen`'s
   * "Product categories" panel is manager-gated). Starts empty on a fresh
   * account; until a manager sets one up, the product form falls back to
   * whatever categories are already in use across the catalogue (see
   * `domain/products.ts`'s `knownCategories`).
   */
  productCategories: string[]
}

const empty = (): Settings => ({
  saleChannels: [...DEFAULT_SALE_CHANNELS],
  printerKind: 'zebra',
  labelPresets: [],
  quickCodes: [],
  productCategories: [],
})

const sanitisePrinterKind = (value: unknown): PrinterKind => (value === 'polono' ? 'polono' : 'zebra')

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
    const printerKind = sanitisePrinterKind(parsed.printerKind)
    const labelTemplate =
      parsed.labelTemplate && typeof parsed.labelTemplate === 'object'
        ? sanitiseLabelTemplate(parsed.labelTemplate)
        : undefined
    const polonoLabelTemplate =
      parsed.polonoLabelTemplate && typeof parsed.polonoLabelTemplate === 'object'
        ? sanitisePolonoLabelTemplate(parsed.polonoLabelTemplate)
        : undefined
    const labelPresets = sanitisePresets(parsed.labelPresets)
    const quickCodes = sanitiseQuickCodes(parsed.quickCodes)
    const productCategories = Array.isArray(parsed.productCategories)
      ? parsed.productCategories.filter((value): value is string => typeof value === 'string')
      : []
    return {
      ...(logoDataUrl ? { logoDataUrl } : {}),
      saleChannels,
      printerKind,
      ...(labelTemplate ? { labelTemplate } : {}),
      ...(polonoLabelTemplate ? { polonoLabelTemplate } : {}),
      labelPresets,
      quickCodes,
      productCategories,
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
  setPrinterKind(kind: PrinterKind): void
  setLabelTemplate(template: LabelTemplate): void
  resetLabelTemplate(): void
  setPolonoLabelTemplate(template: LabelTemplate): void
  resetPolonoLabelTemplate(): void
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
  /** Adds a new saved reference code. Returns the id so the caller (the "add
   * code" form) can do something with it right away if needed. */
  addQuickCode(draft: QuickCodeDraft): string
  updateQuickCode(id: string, patch: Partial<QuickCodeDraft>): void
  deleteQuickCode(id: string): void
  /** Manager-only in the UI (see `SettingsScreen`'s Product categories
   * panel) — adds a new entry to the product-category dropdown's options. */
  addProductCategory(name: string): void
  renameProductCategory(oldName: string, newName: string): void
  removeProductCategory(name: string): void
  /**
   * Overwrites whichever fields are present with values pulled from another
   * source (the account's synced settings in Supabase mode) in one write,
   * rather than three separate setter calls each triggering their own
   * persist/render — see `useSettingsSync`. Deliberately has no
   * `printerKind`/`polonoLabelTemplate` fields — those are device-local, not
   * part of the account's synced settings; see the `Settings` doc comments.
   */
  applyRemote(remote: {
    logoDataUrl?: string
    labelTemplate?: LabelTemplate
    saleChannels?: string[]
    labelPresets?: LabelPreset[]
    quickCodes?: QuickCode[]
    productCategories?: string[]
  }): void
}

/** Thin localStorage-backed store, separate from the inventory repository since
 * the printed-label logo and sale channels are device/business preferences
 * rather than tenant catalogue data. */
export function createSettingsStore(storage: Storage = localStorage): SettingsStore {
  let state = read(storage)
  const persist = () => storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(state))

  return {
    get: () => ({ ...state, saleChannels: [...state.saleChannels], productCategories: [...state.productCategories] }),

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

    setPrinterKind(kind: PrinterKind) {
      state = { ...state, printerKind: sanitisePrinterKind(kind) }
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

    setPolonoLabelTemplate(template: LabelTemplate) {
      state = { ...state, polonoLabelTemplate: sanitisePolonoLabelTemplate(template) }
      persist()
    },

    resetPolonoLabelTemplate() {
      const { polonoLabelTemplate: _drop, ...rest } = state
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

    addQuickCode(draft: QuickCodeDraft) {
      const id = newId('code')
      const [code] = sanitiseQuickCodes([{ ...draft, id }])
      state = { ...state, quickCodes: [...state.quickCodes, code] }
      persist()
      return id
    },

    updateQuickCode(id: string, patch: Partial<QuickCodeDraft>) {
      state = {
        ...state,
        quickCodes: state.quickCodes.map((c) => {
          if (c.id !== id) return c
          const [updated] = sanitiseQuickCodes([{ ...c, ...patch, id }])
          return updated
        }),
      }
      persist()
    },

    deleteQuickCode(id: string) {
      state = { ...state, quickCodes: state.quickCodes.filter((c) => c.id !== id) }
      persist()
    },

    addProductCategory(name: string) {
      const trimmed = name.trim()
      if (!trimmed) return
      const exists = state.productCategories.some((c) => c.toLowerCase() === trimmed.toLowerCase())
      if (exists) return
      state = { ...state, productCategories: [...state.productCategories, trimmed] }
      persist()
    },

    renameProductCategory(oldName: string, newName: string) {
      const trimmed = newName.trim()
      if (!trimmed) return
      state = {
        ...state,
        productCategories: state.productCategories.map((c) => (c === oldName ? trimmed : c)),
      }
      persist()
    },

    removeProductCategory(name: string) {
      state = { ...state, productCategories: state.productCategories.filter((c) => c !== name) }
      persist()
    },

    applyRemote(remote) {
      state = {
        ...state,
        ...(remote.logoDataUrl !== undefined ? { logoDataUrl: remote.logoDataUrl } : {}),
        ...(remote.saleChannels !== undefined ? { saleChannels: [...remote.saleChannels] } : {}),
        ...(remote.labelTemplate !== undefined ? { labelTemplate: sanitiseLabelTemplate(remote.labelTemplate) } : {}),
        ...(remote.labelPresets !== undefined ? { labelPresets: sanitisePresets(remote.labelPresets) } : {}),
        ...(remote.quickCodes !== undefined ? { quickCodes: sanitiseQuickCodes(remote.quickCodes) } : {}),
        ...(remote.productCategories !== undefined
          ? {
              productCategories: remote.productCategories.filter(
                (value): value is string => typeof value === 'string',
              ),
            }
          : {}),
      }
      persist()
    },
  }
}
