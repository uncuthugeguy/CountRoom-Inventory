export const PURCHASE_ORDER_DRAFT_STORAGE_KEY = 'stockflow.purchaseOrderDraft.v2'

/** Mirrors the "New purchase order" form's own field state — kept as
 *  strings (not numbers) so a field can sit empty mid-edit without snapping
 *  to 0, same reasoning ProductFormDialog's quantity/reorder fields use.
 *  Provide either `productId` (an existing catalogue product) or
 *  `customName` (a one-off item, or — when `isLot` is checked — a mixed lot
 *  whose contents aren't known yet). */
export type PurchaseOrderDraftLineKind = 'product' | 'custom' | 'lot'

export interface PurchaseOrderDraftLine {
  kind: PurchaseOrderDraftLineKind
  productId: string
  customName: string
  isLot: boolean
  quantity: string
  /** The line's hammer price as printed on the invoice — the total for the
   *  whole line (all `quantity` units), ex VAT. */
  hammerPrice: string
  /** VAT charged on this line's hammer price, as printed on the invoice. */
  vatAmount: string
}

export interface PurchaseOrderDraft {
  supplierId: string
  poNumber: string
  orderDate: string
  expectedDeliveryDate: string
  notes: string
  lines: PurchaseOrderDraftLine[]
  deliveryCost: string
  buyersPremium: string
  /** Invoice's "total VAT on hammer & premium". Blank = just the line VAT. */
  vatAmount: string
}

interface SavedPurchaseOrderDraft {
  draft: PurchaseOrderDraft
  savedAt: string
}

function read(storage: Storage): SavedPurchaseOrderDraft | null {
  const raw = storage.getItem(PURCHASE_ORDER_DRAFT_STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<SavedPurchaseOrderDraft>
    if (!parsed || typeof parsed !== 'object' || !parsed.draft) return null
    return parsed as SavedPurchaseOrderDraft
  } catch {
    return null
  }
}

/**
 * Thin localStorage-backed autosave for the "New purchase order" form, same
 * reasoning as productDraftStorage.ts/supplierDraftStorage.ts: survives a
 * tab switch, the PWA reloading, or an accidental close of the dialog.
 * There's only ever one in-progress PO draft at a time — there's no "edit
 * an existing PO" form to disambiguate against — so unlike the product/
 * supplier drafts this isn't keyed to anything. Cleared only by a
 * successful "Create draft PO" or by signing out.
 */
export function loadPurchaseOrderDraft(storage: Storage = localStorage): PurchaseOrderDraft | null {
  const draft = read(storage)?.draft
  if (!draft) return null
  // Older drafts stored a per-unit `unitCost` instead of the line's hammer
  // price — convert so a half-typed PO from before the change isn't lost.
  const lines = (draft.lines ?? []).map((line) => {
    const legacy = line as PurchaseOrderDraftLine & { unitCost?: string }
    if (typeof legacy.hammerPrice === 'string') return line
    const { unitCost, ...rest } = legacy
    const qty = Number(rest.quantity) || 0
    const unit = Number(unitCost)
    const hammerPrice = unitCost && unitCost.trim() !== '' && Number.isFinite(unit) ? String(Math.round(unit * qty * 100) / 100) : ''
    return { ...rest, hammerPrice }
  })
  return { ...draft, lines }
}

export function savePurchaseOrderDraft(draft: PurchaseOrderDraft, storage: Storage = localStorage): void {
  const entry: SavedPurchaseOrderDraft = { draft, savedAt: new Date().toISOString() }
  storage.setItem(PURCHASE_ORDER_DRAFT_STORAGE_KEY, JSON.stringify(entry))
}

export function clearPurchaseOrderDraft(storage: Storage = localStorage): void {
  storage.removeItem(PURCHASE_ORDER_DRAFT_STORAGE_KEY)
}
