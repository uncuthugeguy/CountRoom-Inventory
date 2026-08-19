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

export interface PurchaseOrderLine {
  id: string
  poId: string
  productId: string
  sku: string
  name: string
  /** Quantity ordered */
  quantity: number
  /** Unit cost from supplier */
  unitCost: number
  /** Total line cost */
  lineTotal: number
  /** Quantity actually received (tracked when PO is marked received) */
  quantityReceived?: number
}

export interface PurchaseOrderLineInput {
  productId: string
  quantity: number
  unitCost: number
}

export interface PurchaseOrder {
  id: string
  supplierId: string
  supplierName: string
  status: PurchaseOrderStatus
  /** Expected delivery date */
  expectedDeliveryDate: string
  /** Actual delivery date, set when received */
  receivedDate?: string
  notes: string
  lines: PurchaseOrderLine[]
  subtotal: number
  createdAt: string
  updatedAt?: string
}

export interface PurchaseOrderInput {
  supplierId: string
  expectedDeliveryDate: string
  notes: string
  lines: PurchaseOrderLineInput[]
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
        onOrder.add(line.productId)
      }
    }
  }

  return products.filter(
    (p) =>
      p.reorderLevel > 0 && p.quantity <= p.reorderLevel && !onOrder.has(p.id),
  )
}
