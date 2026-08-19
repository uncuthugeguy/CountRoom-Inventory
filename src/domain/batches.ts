// ============================================================================
// BATCH/LOT TRACKING & EXPIRY MANAGEMENT
// ============================================================================

/**
 * A batch or lot represents a group of units from a single supplier shipment,
 * manufacturing run, or production date. Essential for FIFO/LIFO and expiry tracking.
 */
export interface StockBatch {
  id: string
  productId: string
  /** Supplier lot number, manufacturer batch code, etc. */
  batchNumber: string
  /** When this batch was received / added to stock */
  receivedDate: string
  /** When these units expire (if applicable) */
  expiryDate?: string
  /** Quantity of this batch still in stock */
  quantity: number
  /** Unit cost (may vary by batch, especially across suppliers) */
  unitCost: number
  /** FIFO: queue, LIFO: stack, etc. */
  disposition: 'fifo' | 'lifo' | 'fefo' // First-in-first-out, Last-in-first-out, First-expire-first-out
  notes: string
  createdAt: string
  updatedAt: string
}

export type StockBatchDraft = Omit<StockBatch, 'id' | 'quantity' | 'createdAt' | 'updatedAt'>

export interface StockBatchInput {
  productId: string
  batchNumber: string
  quantity: number
  receivedDate: string
  expiryDate?: string
  unitCost: number
  disposition?: 'fifo' | 'lifo' | 'fefo'
  notes?: string
}

/**
 * When withdrawing stock (sale, write-off, etc.), track which batches were consumed.
 */
export interface BatchWithdrawal {
  id: string
  batchId: string
  quantity: number
  reason: 'sale' | 'adjustment' | 'writeoff' | 'damaged'
  withdrawalDate: string
}

// ============================================================================
// EXPIRY & QUALITY ALERTS
// ============================================================================

export type ExpiryAlertType = 'expiring-soon' | 'expired' | 'no-expiry-date'

export interface ExpiryAlert {
  id: string
  batchId: string
  productId: string
  productName: string
  batchNumber: string
  expiryDate?: string
  quantityAtRisk: number
  alertType: ExpiryAlertType
  daysUntilExpiry?: number // Negative if already expired
  createdAt: string
  resolvedAt?: string
}

// ============================================================================
// BATCH CALCULATIONS & RETRIEVAL
// ============================================================================

/**
 * Get available batches for a product, ordered by disposal strategy (FIFO/LIFO/FEFO).
 */
export function getAvailableBatches(
  batches: StockBatch[],
  productId: string,
): StockBatch[] {
  const available = batches.filter((b) => b.productId === productId && b.quantity > 0)

  // Determine primary disposition (most common for this product)
  const dispositionCounts = new Map<string, number>()
  for (const batch of available) {
    dispositionCounts.set(batch.disposition, (dispositionCounts.get(batch.disposition) ?? 0) + 1)
  }
  const disposition = Array.from(dispositionCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0]

  // Sort by disposition strategy
  if (disposition === 'fifo') {
    return available.sort((a, b) => new Date(a.receivedDate).getTime() - new Date(b.receivedDate).getTime())
  }
  if (disposition === 'lifo') {
    return available.sort((a, b) => new Date(b.receivedDate).getTime() - new Date(a.receivedDate).getTime())
  }
  if (disposition === 'fefo') {
    // Expired items first, then by soonest expiry
    return available.sort((a, b) => {
      const aExpires = a.expiryDate ? new Date(a.expiryDate).getTime() : Infinity
      const bExpires = b.expiryDate ? new Date(b.expiryDate).getTime() : Infinity
      return aExpires - bExpires
    })
  }

  return available
}

/**
 * Detect batches that are expiring soon or already expired.
 */
export function getExpiryAlerts(
  batches: StockBatch[],
  productNames: Map<string, string>,
  warningDaysBefore: number = 7,
): ExpiryAlert[] {
  const alerts: ExpiryAlert[] = []
  const now = new Date()
  now.setHours(0, 0, 0, 0)

  for (const batch of batches) {
    if (batch.quantity === 0) continue // Already consumed

    const productName = productNames.get(batch.productId) ?? 'Unknown'

    if (!batch.expiryDate) {
      // No expiry date set — may need clarification
      if (batch.disposition === 'fefo') {
        // Only alert on FEFO items (where expiry matters)
        alerts.push({
          id: `expiry-alert-${batch.id}-${Date.now()}`,
          batchId: batch.id,
          productId: batch.productId,
          productName,
          batchNumber: batch.batchNumber,
          quantityAtRisk: batch.quantity,
          alertType: 'no-expiry-date',
          createdAt: now.toISOString(),
        })
      }
      continue
    }

    // Parse date string as YYYY-MM-DD (local date, not UTC)
    const [year, month, day] = batch.expiryDate.split('-').map(Number)
    const expiryDate = new Date(year, month - 1, day, 0, 0, 0, 0)
    const daysUntilExpiry = Math.floor((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

    if (daysUntilExpiry < 0) {
      // Already expired
      alerts.push({
        id: `expiry-alert-${batch.id}-${Date.now()}`,
        batchId: batch.id,
        productId: batch.productId,
        productName,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        quantityAtRisk: batch.quantity,
        alertType: 'expired',
        daysUntilExpiry,
        createdAt: now.toISOString(),
      })
    } else if (daysUntilExpiry <= warningDaysBefore) {
      // Expiring soon
      alerts.push({
        id: `expiry-alert-${batch.id}-${Date.now()}`,
        batchId: batch.id,
        productId: batch.productId,
        productName,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        quantityAtRisk: batch.quantity,
        alertType: 'expiring-soon',
        daysUntilExpiry,
        createdAt: now.toISOString(),
      })
    }
  }

  return alerts
}

/**
 * Calculate the cost basis for inventory, considering per-batch costs.
 */
export function calculateBatchCostBasis(batches: StockBatch[]): number {
  return batches.reduce((sum, batch) => sum + batch.quantity * batch.unitCost, 0)
}

/**
 * Estimate waste / value at risk from expired batches.
 */
export function calculateExpiryLoss(
  expiredBatches: StockBatch[],
): { quantity: number; costValue: number } {
  let quantity = 0
  let costValue = 0

  for (const batch of expiredBatches) {
    if (batch.quantity > 0) {
      quantity += batch.quantity
      costValue += batch.quantity * batch.unitCost
    }
  }

  return { quantity, costValue }
}

/**
 * Track batch withdrawals for audit trail and FIFO/LIFO validation.
 */
export function withdrawFromBatch(
  batch: StockBatch,
  quantityToWithdraw: number,
): { updated: StockBatch; withdrawal: BatchWithdrawal } | { error: string } {
  if (quantityToWithdraw > batch.quantity) {
    return { error: `Only ${batch.quantity} units available in batch ${batch.batchNumber}.` }
  }

  const withdrawal: BatchWithdrawal = {
    id: `wd-${batch.id}-${Date.now()}`,
    batchId: batch.id,
    quantity: quantityToWithdraw,
    reason: 'sale',
    withdrawalDate: new Date().toISOString(),
  }

  return {
    updated: {
      ...batch,
      quantity: batch.quantity - quantityToWithdraw,
      updatedAt: new Date().toISOString(),
    },
    withdrawal,
  }
}
