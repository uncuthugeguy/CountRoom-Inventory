import { setCustomPaymentMethods } from '../domain/paymentMethods'
import { sanitiseQuickCodes, type QuickCode, type QuickCodeDraft } from '../domain/quickCodes'
import { isBarcodeLabelLayout, sanitiseBarcodeLabelLayout, type BarcodeLabelLayout } from '../printing/barcodeLabelLayout'
import {
  DEFAULT_LABEL_PRINTER_SETTINGS,
  sanitiseLabelPrinterSettings,
  type LabelPrinterSettings,
} from '../printing/labelPrinterSettings'

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
  /** Where a sale can be attributed to — user-managed, offered as quick picks when recording or editing a sale. */
  saleChannels: string[]
  /** The 2 × 1 in barcode label layout. Synced to the account so every
   * device prints the same label. Falls back to `DEFAULT_BARCODE_LABEL_LAYOUT`. */
  barcodeLabelLayout?: BarcodeLabelLayout
  /** Which Polono this device prints to and how it's lined up — device-local,
   * never synced, since it depends on this machine's printer driver. */
  labelPrinter: LabelPrinterSettings
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
  labelPrinter: sanitiseLabelPrinterSettings(DEFAULT_LABEL_PRINTER_SETTINGS),
  quickCodes: [],
  productCategories: [],
})

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
    // Older saves may still carry the Zebra-era `labelTemplate`,
    // `polonoLabelTemplate`, `printerKind` etc. — they're simply dropped.
    const barcodeLabelLayout = isBarcodeLabelLayout(parsed.barcodeLabelLayout)
      ? sanitiseBarcodeLabelLayout(parsed.barcodeLabelLayout)
      : undefined
    const labelPrinter = sanitiseLabelPrinterSettings(parsed.labelPrinter)
    const quickCodes = sanitiseQuickCodes(parsed.quickCodes)
    const productCategories = Array.isArray(parsed.productCategories)
      ? parsed.productCategories.filter((value): value is string => typeof value === 'string')
      : []
    return {
      ...(logoDataUrl ? { logoDataUrl } : {}),
      saleChannels,
      ...(barcodeLabelLayout ? { barcodeLabelLayout } : {}),
      labelPrinter,
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
  setBarcodeLabelLayout(layout: BarcodeLabelLayout): void
  resetBarcodeLabelLayout(): void
  setLabelPrinter(printer: LabelPrinterSettings): void
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
   * `labelPrinter` field — that's device-local; see the `Settings` doc comments.
   */
  applyRemote(remote: {
    logoDataUrl?: string
    barcodeLabelLayout?: BarcodeLabelLayout
    saleChannels?: string[]
    quickCodes?: QuickCode[]
    productCategories?: string[]
    paymentMethods?: { key: string; label: string }[]
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

    setBarcodeLabelLayout(layout: BarcodeLabelLayout) {
      state = { ...state, barcodeLabelLayout: sanitiseBarcodeLabelLayout(layout) }
      persist()
    },

    resetBarcodeLabelLayout() {
      const { barcodeLabelLayout: _drop, ...rest } = state
      state = rest
      persist()
    },

    setLabelPrinter(printer: LabelPrinterSettings) {
      state = { ...state, labelPrinter: sanitiseLabelPrinterSettings(printer) }
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
      // Payment methods aren't part of local Settings (Register owns them);
      // they only feed the label lookup in domain/paymentMethods.
      if (remote.paymentMethods !== undefined) setCustomPaymentMethods(remote.paymentMethods)
      state = {
        ...state,
        ...(remote.logoDataUrl !== undefined ? { logoDataUrl: remote.logoDataUrl } : {}),
        ...(remote.saleChannels !== undefined ? { saleChannels: [...remote.saleChannels] } : {}),
        ...(isBarcodeLabelLayout(remote.barcodeLabelLayout)
          ? { barcodeLabelLayout: sanitiseBarcodeLabelLayout(remote.barcodeLabelLayout) }
          : {}),
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
