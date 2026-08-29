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
