// ============================================================================
// SUPPLIER MANAGEMENT
// ============================================================================

export interface Supplier {
  id: string
  name: string
  email: string
  phone: string
  address: string
  /** Average lead time in days */
  leadTimeDays: number
  /** Contact person at the supplier */
  contactName: string
  /** Notes about payment terms, minimums, etc. */
  notes: string
  createdAt: string
  updatedAt: string
}

export type SupplierDraft = Omit<Supplier, 'id' | 'createdAt' | 'updatedAt'>

// ============================================================================
// PURCHASE ORDERS
// ============================================================================

export type PurchaseOrderStatus = 'draft' | 'sent' | 'confirmed' | 'received' | 'cancelled'

/**
 * One item actually found once a lot line was unboxed — see
 * `PurchaseOrderLine.unboxedInto` below. Snapshots `sku`/`name` the same way
 * `PurchaseOrderLine` itself does, so the record still reads correctly if
 * the product is later renamed or deleted.
 */
export interface PurchaseOrderLineUnboxedItem {
  productId: string
  sku: string
  name: string
  quantity: number
  /** This item's share of the lot's total cost — the allocations across one
   *  lot's `unboxedInto` don't have to sum exactly to the lot's `lineTotal`
   *  (rounding, or a deliberate "call it even" split), but the UI steers
   *  toward that. */
  allocatedCost: number
}

export interface PurchaseOrderLine {
  id: string
  poId: string
  /**
   * Set when this line is a specific catalogue product ordered by the unit.
   * Unset for a `customName` line (a one-off item not in the catalogue yet)
   * or an `isLot` line (a mixed/unknown lot — see below) — both of those
   * only gain a real product link once unboxed.
   */
  productId?: string
  sku: string
  name: string
  /**
   * A free-text name used instead of `productId` — either a one-off item
   * you haven't catalogued yet, or (when `isLot` is true) the auction
   * house's own lot description, e.g. "QUANTITY OF HEALTH & BEAUTY ITEMS TO
   * INCLUDE REMINGTON XR1500". `name`/`sku` above are set from this so
   * existing display code doesn't need to special-case it.
   */
  customName?: string
  /**
   * True for a job lot bought as one unit whose actual contents aren't
   * known/split out yet (bulk auction lots are the main case this exists
   * for). A lot line is never received the normal way — it's "unboxed"
   * instead (see `unboxPurchaseOrderLine`), which is the only thing that
   * turns it into real stock.
   */
  isLot?: boolean
  /** Quantity ordered. For a lot line this is normally 1 (one lot). */
  quantity: number
  /** Unit cost from supplier. For a lot line, the lot's own hammer price. */
  unitCost: number
  /** Total line cost (hammer price for this line, ex. VAT/premium). */
  lineTotal: number
  /** VAT charged on this specific line (auction invoices show VAT per lot). */
  vatAmount?: number
  /** Quantity actually received (tracked when PO is marked received) — not
   *  used for lot lines, which use `unboxedInto` instead. */
  quantityReceived?: number
  /** Set once a lot line has been unboxed into real stock. */
  unboxedInto?: PurchaseOrderLineUnboxedItem[]
}

export interface PurchaseOrderLineInput {
  /** Provide exactly one of `productId` or `customName`. */
  productId?: string
  customName?: string
  isLot?: boolean
  quantity: number
  unitCost: number
  vatAmount?: number
}

export interface PurchaseOrder {
  id: string
  supplierId: string
  supplierName: string
  status: PurchaseOrderStatus
  /** Your own reference for this order — defaults to a generated sequence
   *  (`PO-0001`, …) but is freely editable, e.g. to match a supplier's own
   *  invoice number instead. */
  poNumber: string
  /** The date the order was actually placed/paid (may differ from when the
   *  PO record itself was created in CountRoom). */
  orderDate: string
  /** Expected delivery date */
  expectedDeliveryDate: string
  /** Actual delivery date, set when received */
  receivedDate?: string
  notes: string
  lines: PurchaseOrderLine[]
  /** Sum of line totals (hammer/ex-VAT/ex-premium cost of the goods themselves). */
  subtotal: number
  /** Delivery/shipping charged on top of the goods. */
  deliveryCost: number
  /** A buyer's premium charged on top (common on auction invoices). */
  buyersPremium: number
  /** Total VAT for the order — on an auction invoice this is usually VAT on
   *  both the hammer price and the premium combined, so it's entered as one
   *  figure rather than summed from the per-line `vatAmount`s. */
  vatAmount: number
  /** subtotal + deliveryCost + buyersPremium + vatAmount, rounded to the
   *  penny — kept as its own field (rather than always recomputed) so it can
   *  be nudged to match the supplier's own stated total when rounding
   *  differs by a penny or two. */
  grandTotal: number
  createdAt: string
  updatedAt?: string
}

export interface PurchaseOrderInput {
  supplierId: string
  poNumber: string
  orderDate: string
  expectedDeliveryDate: string
  notes: string
  lines: PurchaseOrderLineInput[]
  deliveryCost: number
  buyersPremium: number
  vatAmount: number
  /** Optional override for the computed grand total (see `grandTotal` above). */
  grandTotal?: number
}

/** One item found while unboxing a lot — either an existing catalogue
 *  product (`productId`) or a brand-new one to create on the spot
 *  (`newProduct`), snapshotting just enough to add it to the catalogue. */
export interface UnboxedLineItemInput {
  productId?: string
  newProduct?: {
    sku: string
    name: string
    category: string
    location: string
    barcode: string
  }
  quantity: number
  allocatedCost: number
}

// ============================================================================
// SUPPLIER PRODUCT PRICING
// ============================================================================

/** Link a supplier to a product with pricing and minimum order info */
export interface SupplierProduct {
  id: string
  productId: string
  supplierId: string
  /** Unit cost when buying from this supplier */
  unitCost: number
  /** Minimum order quantity */
  minimumOrder: number
  /** Notes (pack sizes, special handling, etc.) */
  notes: string
  updatedAt: string
}

export type SupplierProductDraft = Omit<SupplierProduct, 'id' | 'updatedAt'>

// ============================================================================
// CALCULATIONS & HELPERS
// ============================================================================

export function poLineTotal(quantity: number, unitCost: number): number {
  return quantity * unitCost
}

export function calculatePOSubtotal(lines: PurchaseOrderLine[]): number {
  return lines.reduce((sum, line) => sum + line.lineTotal, 0)
}

/** Rounds to the penny — used so `grandTotal` doesn't carry stray
 *  floating-point tails (e.g. 116.67999999999999). */
export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100
}

export function calculatePOGrandTotal(totals: {
  subtotal: number
  deliveryCost: number
  buyersPremium: number
  vatAmount: number
}): number {
  return roundCurrency(totals.subtotal + totals.deliveryCost + totals.buyersPremium + totals.vatAmount)
}

/**
 * Invoice-style totals for a purchase order, laid out the way an auction
 * invoice (John Pye etc.) prints them: each line has its own hammer price
 * and VAT; the order then shows net hammer, delivery, net buyer's premium,
 * total VAT on hammer + premium, and the grand total.
 *
 * `totalVat` is the invoice's own "VAT on hammer & premium" figure. When it's
 * left blank (undefined) it falls back to just the per-line hammer VAT, so
 * the grand total still adds up while you're part-way through typing.
 */
export interface PoInvoiceTotalsInput {
  /** `quantity` is used to split delivery/premium evenly per item; lines
   *  without one count as a single item. */
  lines: Array<{ hammerPrice: number; vatAmount: number; quantity?: number }>
  deliveryCost: number
  buyersPremium: number
  totalVat?: number
}

export interface PoInvoiceTotals {
  /** Sum of every line's hammer price (ex VAT). */
  netHammer: number
  /** Sum of every line's own VAT. */
  hammerVat: number
  /** Hammer + VAT on hammer, before delivery/premium. */
  subtotal: number
  deliveryCost: number
  buyersPremium: number
  /** VAT on hammer and premium combined. */
  totalVat: number
  /** What's left of `totalVat` once the hammer VAT is taken off — i.e. the
   *  VAT that must have been charged on the premium (never negative). */
  premiumVat: number
  grandTotal: number
  /** Total number of items across every line (a lot counts as its own
   *  quantity, normally 1, since its contents aren't known yet). */
  totalItems: number
  /** Delivery + buyer's premium + VAT on premium, split evenly across every
   *  item on the order (unrounded — round only the final per-item figure). */
  overheadPerItem: number
}

export function calculatePoInvoiceTotals(input: PoInvoiceTotalsInput): PoInvoiceTotals {
  const netHammer = roundCurrency(input.lines.reduce((sum, line) => sum + line.hammerPrice, 0))
  const hammerVat = roundCurrency(input.lines.reduce((sum, line) => sum + line.vatAmount, 0))
  const totalVat = roundCurrency(input.totalVat ?? hammerVat)
  const totalItems = input.lines.reduce((sum, line) => sum + (line.quantity ?? 1), 0)
  return {
    netHammer,
    hammerVat,
    subtotal: roundCurrency(netHammer + hammerVat),
    deliveryCost: roundCurrency(input.deliveryCost),
    buyersPremium: roundCurrency(input.buyersPremium),
    totalVat,
    premiumVat: roundCurrency(Math.max(0, totalVat - hammerVat)),
    totalItems,
    overheadPerItem:
      totalItems > 0
        ? (input.deliveryCost + input.buyersPremium + Math.max(0, totalVat - hammerVat)) / totalItems
        : 0,
    grandTotal: calculatePOGrandTotal({
      subtotal: netHammer,
      deliveryCost: input.deliveryCost,
      buyersPremium: input.buyersPremium,
      vatAmount: totalVat,
    }),
  }
}

/** Per-item cost of one invoice line: (hammer + that line's VAT) ÷ quantity,
 *  to the penny. VAT is included because the business isn't VAT-registered,
 *  so VAT paid is a real, unreclaimable cost of the stock. */
export function poLineCostPerItem(hammerPrice: number, vatAmount: number, quantity: number): number {
  if (!(quantity > 0)) return 0
  return roundCurrency((hammerPrice + vatAmount) / quantity)
}

/**
 * True landed cost of one item on a PO line: its own hammer + VAT per item,
 * plus an even share of the order's delivery, buyer's premium and VAT on
 * premium (`overheadPerItem` from `calculatePoInvoiceTotals`). Every item's
 * true cost × quantity adds back up to the grand total (give or take
 * penny rounding).
 */
export function poLineTrueCostPerItem(
  hammerPrice: number,
  vatAmount: number,
  quantity: number,
  overheadPerItem: number,
): number {
  if (!(quantity > 0)) return 0
  return roundCurrency((hammerPrice + vatAmount) / quantity + overheadPerItem)
}

const PO_NUMBER_PATTERN = /^PO-(\d+)$/i

/** Finds the next PO number in the `PO-NNNN` sequence, same idea as
 *  `nextSku` in `domain/products.ts`. Starts at `PO-0001`. */
export function nextPoNumber(purchaseOrders: PurchaseOrder[]): string {
  const highest = purchaseOrders.reduce((max, po) => {
    const match = PO_NUMBER_PATTERN.exec(po.poNumber?.trim() ?? '')
    if (!match) return max
    return Math.max(max, Number(match[1]))
  }, 0)
  return `PO-${String(highest + 1).padStart(4, '0')}`
}

/**
 * Get the best supplier for a product by unit cost.
 * Returns undefined if no suppliers are linked to this product.
 */
export function findBestSupplier(
  product: { id: string },
  supplierProducts: SupplierProduct[],
  suppliers: Map<string, Supplier>,
): { supplier: Supplier; product: SupplierProduct } | undefined {
  const options = supplierProducts
    .filter((sp) => sp.productId === product.id)
    .sort((a, b) => a.unitCost - b.unitCost)

  if (options.length === 0) return undefined

  const best = options[0]
  const supplier = suppliers.get(best.supplierId)
  if (!supplier) return undefined

  return { supplier, product: best }
}

/**
 * Filter products that are at or below their reorder level and don't already
 * have a pending/sent purchase order.
 */
export function productsNeedingReorder(
  products: Array<{ id: string; quantity: number; reorderLevel: number }>,
  _poLines: PurchaseOrderLine[],
  posByStatus: Map<PurchaseOrderStatus, PurchaseOrder[]>,
): Array<{ id: string; quantity: number; reorderLevel: number }> {
  // Collect all product IDs that have a pending/sent/confirmed PO
  const onOrder = new Set<string>()
  for (const status of ['draft', 'sent', 'confirmed'] as const) {
    const pos = posByStatus.get(status) || []
    for (const po of pos) {
      for (const line of po.lines) {
        if (line.productId) onOrder.add(line.productId)
      }
    }
  }

  return products.filter(
    (p) =>
      p.reorderLevel > 0 && p.quantity <= p.reorderLevel && !onOrder.has(p.id),
  )
}
