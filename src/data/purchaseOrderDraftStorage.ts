export const PURCHASE_ORDER_DRAFT_STORAGE_KEY = 'stockflow.purchaseOrderDraft.v1'

/** Mirrors the "New purchase order" form's own field state — kept as
 *  strings (not numbers) so a field can sit empty mid-edit without snapping
 *  to 0, same reasoning ProductFormDialog's quantity/reorder fields use. */
export interface PurchaseOrderDraftLine {
  productId: string
  quantity: string
  unitCost: string
}

export interface PurchaseOrderDraft {
  supplierId: string
  expectedDeliveryDate: string
  notes: string
  lines: PurchaseOrderDraftLine[]
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
  return read(storage)?.draft ?? null
}

export function savePurchaseOrderDraft(draft: PurchaseOrderDraft, storage: Storage = localStorage): void {
  const entry: SavedPurchaseOrderDraft = { draft, savedAt: new Date().toISOString() }
  storage.setItem(PURCHASE_ORDER_DRAFT_STORAGE_KEY, JSON.stringify(entry))
}

export function clearPurchaseOrderDraft(storage: Storage = localStorage): void {
  storage.removeItem(PURCHASE_ORDER_DRAFT_STORAGE_KEY)
}
