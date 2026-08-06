export interface Product {
  id: string
  /** A manufacturer barcode; not every line has one, so this may be blank. */
  barcode: string
  sku: string
  name: string
  category: string
  location: string
  /** Colour, size or similar — free text, offered as a dropdown of prior values. */
  variation: string
  quantity: number
  reorderLevel: number
  /** What this unit costs you — the basis for profit/loss at checkout. */
  cost: number
  /** Default sale price; checkout pre-fills this but can override it per sale. */
  price: number
  createdAt: string
  updatedAt: string
}

/** Fields a user supplies when creating or editing a product. */
export type ProductDraft = Omit<Product, 'id' | 'createdAt' | 'updatedAt'>

export type MovementType = 'in' | 'out' | 'adjust'

export interface MovementInput {
  type: MovementType
  /**
   * For `in` and `out` this is the magnitude to add or remove.
   * For `adjust` this is the new absolute count on hand (a stocktake).
   */
  quantity: number
  reason?: string
}

export interface StockMovement {
  id: string
  productId: string
  type: MovementType
  /** The quantity as entered by the user (see MovementInput). */
  quantity: number
  /** Signed change applied to the quantity on hand. */
  delta: number
  previousQuantity: number
  newQuantity: number
  reason?: string
  createdAt: string
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  in: 'Stock in',
  out: 'Stock out',
  adjust: 'Adjust',
}

export type PaymentMethod = 'cash' | 'card' | 'other'

export const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'card', 'other']

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  other: 'Other',
}

/** One line of a sale as submitted to the repository. */
export interface SaleLineInput {
  productId: string
  quantity: number
  /** The price actually charged for this line — may differ from the product's default. */
  unitPrice: number
}

export interface SaleInput {
  /** Where it sold — eBay, Facebook Marketplace, a walk-in sale, etc. Free text, user-managed list. */
  channel: string
  paymentMethod: PaymentMethod
  lines: SaleLineInput[]
}

/** A sale line as recorded — snapshots the product's name/SKU/cost so history
 * reads correctly even if the product is later renamed or deleted. */
export interface SaleLine {
  id: string
  saleId: string
  productId: string
  sku: string
  name: string
  quantity: number
  unitPrice: number
  unitCost: number
  lineTotal: number
  lineProfit: number
}

export interface Sale {
  id: string
  channel: string
  paymentMethod: PaymentMethod
  subtotal: number
  totalCost: number
  profit: number
  createdAt: string
  lines: SaleLine[]
}

// --- Returns, refunds, replacements and goodwill gestures -----------------
//
// A single case can be any combination of these four actions at once (e.g. a
// customer returns one item for a refund AND gets a goodwill voucher for the
// inconvenience). Every field on ReturnCaseInput is optional — a case can be
// as small as "gave a voucher, no item involved" or as complete as a full
// refund plus a restocked item plus a note.

export type ReturnAction = 'refund' | 'return' | 'replacement' | 'goodwill'

export const RETURN_ACTIONS: ReturnAction[] = ['refund', 'return', 'replacement', 'goodwill']

export const RETURN_ACTION_LABELS: Record<ReturnAction, string> = {
  refund: 'Refund',
  return: 'Return',
  replacement: 'Replacement',
  goodwill: 'Goodwill gesture',
}

/** What happens to a returned item once it's back in hand. */
export type StockDisposition = 'restock' | 'writeoff'

export const STOCK_DISPOSITIONS: StockDisposition[] = ['restock', 'writeoff']

export const STOCK_DISPOSITION_LABELS: Record<StockDisposition, string> = {
  restock: 'Back into stock',
  writeoff: 'Written off',
}

/** One physical item coming back from a customer — the item itself for a
 * plain return, or the "old" side of a replacement. */
export interface ReturnLineInput {
  productId: string
  quantity: number
  disposition: StockDisposition
}

/** A returned line as recorded — snapshots sku/name/cost so history reads
 * correctly even if the product is later renamed or deleted, the same way
 * SaleLine does. */
export interface ReturnLine {
  id: string
  returnId: string
  productId: string
  sku: string
  name: string
  quantity: number
  disposition: StockDisposition
  unitCost: number
}

/** One item going back out to the customer — the "new" side of a
 * replacement. Decrements stock exactly like a sale line, but at no charge. */
export interface ReplacementLineInput {
  productId: string
  quantity: number
}

export interface ReplacementLine {
  id: string
  returnId: string
  productId: string
  sku: string
  name: string
  quantity: number
  unitCost: number
}

export interface ReturnCaseInput {
  /** Links back to the original till sale, when there was one and it's known. */
  saleId?: string
  channel?: string
  /** Free text — name, email, order number, whatever identifies who this is for. */
  customerRef?: string
  reason?: string
  notes?: string
  /** Any subset of the four actions, including none (e.g. a note-only record). */
  actions: ReturnAction[]
  refundAmount?: number
  refundMethod?: PaymentMethod
  /** Free text — "Voucher", "Store credit", "Discount code", etc. */
  goodwillType?: string
  goodwillValue?: number
  returnLines?: ReturnLineInput[]
  replacementLines?: ReplacementLineInput[]
}

export interface ReturnCase {
  id: string
  saleId: string
  channel: string
  customerRef: string
  reason: string
  notes: string
  actions: ReturnAction[]
  refundAmount: number
  refundMethod: PaymentMethod | null
  goodwillType: string
  goodwillValue: number
  returnLines: ReturnLine[]
  replacementLines: ReplacementLine[]
  createdAt: string
}
