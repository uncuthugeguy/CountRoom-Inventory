import type { PaymentMethod, Product } from '../domain/types'
import type { Cart, SaleFeesDraft } from '../domain/sales'

export const SALE_EDIT_DRAFT_STORAGE_KEY = 'stockflow.saleEditDraft.v1'

/** Only the fields needed to rebuild a cart line — not the embedded
 *  `Product`, so a restored draft always re-hydrates against the *current*
 *  catalogue (fresh price/cost/stock) rather than resurrecting a stale
 *  snapshot from whenever the draft was saved. */
export interface SaleEditCartLineDraft {
  productId: string
  quantity: number
  unitPrice: number
}

interface SavedSaleEditDraft {
  saleId: string
  cart: SaleEditCartLineDraft[]
  channel: string
  paymentMethod: PaymentMethod
  fees: SaleFeesDraft
  savedAt: string
}

function read(storage: Storage): SavedSaleEditDraft | null {
  const raw = storage.getItem(SALE_EDIT_DRAFT_STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<SavedSaleEditDraft>
    if (!parsed || typeof parsed !== 'object' || !parsed.saleId || !Array.isArray(parsed.cart)) return null
    return parsed as SavedSaleEditDraft
  } catch {
    return null
  }
}

/**
 * Thin localStorage-backed autosave for the "Edit sale" dialog, same
 * reasoning as productDraftStorage.ts: nothing here touches the inventory
 * repository, it exists purely so a half-finished edit (items, quantities,
 * prices, channel, payment method, fees) survives the dialog being torn down
 * and rebuilt — which, unlike the product form, happens on every internal
 * CountRoom tab switch as well as a real tab/app switch, since the dialog is
 * only ever open while History's Sales view is mounted. Cleared only by a
 * successful save or by signing out — never just by hitting Cancel or
 * switching away, same rule productDraftStorage.ts documents.
 */
export function loadSaleEditDraftFor(
  saleId: string,
  storage: Storage = localStorage,
): SavedSaleEditDraft | null {
  const saved = read(storage)
  if (!saved) return null
  return saved.saleId === saleId ? saved : null
}

/** Rebuilds a `Cart` from a saved draft against the current catalogue,
 *  silently dropping any line whose product no longer exists — same
 *  tolerance `buildEditCart` already has for the original sale's lines. */
export function hydrateSaleEditCart(lines: SaleEditCartLineDraft[], products: Product[]): Cart {
  return lines.flatMap((line) => {
    const product = products.find((p) => p.id === line.productId)
    return product ? [{ product, quantity: line.quantity, unitPrice: line.unitPrice }] : []
  })
}

export function saveSaleEditDraft(
  saleId: string,
  cart: Cart,
  channel: string,
  paymentMethod: PaymentMethod,
  fees: SaleFeesDraft,
  storage: Storage = localStorage,
): void {
  const entry: SavedSaleEditDraft = {
    saleId,
    cart: cart.map((line) => ({
      productId: line.product.id,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
    })),
    channel,
    paymentMethod,
    fees,
    savedAt: new Date().toISOString(),
  }
  storage.setItem(SALE_EDIT_DRAFT_STORAGE_KEY, JSON.stringify(entry))
}

export function clearSaleEditDraft(storage: Storage = localStorage): void {
  storage.removeItem(SALE_EDIT_DRAFT_STORAGE_KEY)
}
