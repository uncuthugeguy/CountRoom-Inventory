import type { Product } from './types'

// ============================================================================
// ALERT TYPES
// ============================================================================

export type AlertSeverity = 'info' | 'warning' | 'critical'
export type AlertCategory = 'low-stock' | 'out-of-stock' | 'reorder-suggested' | 'sync-failed' | 'custom'

export interface Alert {
  id: string
  category: AlertCategory
  severity: AlertSeverity
  title: string
  message: string
  /** Reference to related product ID, if any */
  productId?: string
  /** Reference to related sale ID, if any */
  saleId?: string
  /** When alert was triggered */
  createdAt: string
  /** When the condition causing the alert was resolved (dismissed or fixed) */
  resolvedAt?: string
  /** Whether user has acknowledged this alert */
  acknowledged: boolean
}

export type AlertDraft = Omit<Alert, 'id' | 'createdAt' | 'acknowledged'>

// ============================================================================
// ALERT RULE ENGINE
// ============================================================================

/**
 * Rules that determine when to generate alerts.
 * Can be customized per account.
 */
export interface AlertRules {
  /** Alert when stock drops to or below reorder level */
  alertOnLowStock: boolean
  /** Alert when stock hits zero */
  alertOnOutOfStock: boolean
  /** Automatically suggest creating PO when low-stock alert fires */
  autoSuggestReorder: boolean
  /** Auto-create draft POs for low-stock items (not sent, just created) */
  autoCreateDraftPOs: boolean
  /** Don't alert on products with no reorder level set */
  ignoreUnmonitoredProducts: boolean
  /** Alert minimum gap: don't alert on same product more than once per X hours */
  alertDedupHours: number
}

export const DEFAULT_ALERT_RULES: AlertRules = {
  alertOnLowStock: true,
  alertOnOutOfStock: true,
  autoSuggestReorder: true,
  autoCreateDraftPOs: false, // Disabled by default for safety
  ignoreUnmonitoredProducts: true,
  alertDedupHours: 4, // Don't spam same product alerts more than once per 4 hours
}

// ============================================================================
// ALERT GENERATION
// ============================================================================

export interface ReorderSuggestion {
  productId: string
  sku: string
  name: string
  currentQuantity: number
  reorderLevel: number
  suggestedQuantity: number
  bestSupplierId?: string
  bestSupplierName?: string
  unitCost?: number
  estimatedTotal?: number
}

/**
 * Detect all products currently below their reorder level.
 */
export function findLowStockProducts(products: Product[]): Product[] {
  return products.filter((p) => p.reorderLevel > 0 && p.quantity > 0 && p.quantity <= p.reorderLevel)
}

/**
 * Detect all products currently out of stock.
 */
export function findOutOfStockProducts(products: Product[]): Product[] {
  return products.filter((p) => p.quantity === 0)
}

/**
 * Generate alerts for low-stock / out-of-stock conditions.
 * Takes existing alerts to avoid duplicates within the dedup window.
 */
export function generateStockAlerts(
  products: Product[],
  existingAlerts: Alert[],
  rules: AlertRules,
): Alert[] {
  const alerts: Alert[] = []
  const now = new Date()
  const dedupWindow = rules.alertDedupHours * 60 * 60 * 1000

  const recentAlertsByProductId = new Map<string, Alert>()
  for (const alert of existingAlerts) {
    if (alert.resolvedAt) continue // Skip resolved alerts
    if (!alert.productId) continue
    const age = now.getTime() - new Date(alert.createdAt).getTime()
    if (age < dedupWindow) {
      if (!recentAlertsByProductId.has(alert.productId)) {
        recentAlertsByProductId.set(alert.productId, alert)
      }
    }
  }

  if (rules.alertOnOutOfStock) {
    for (const product of findOutOfStockProducts(products)) {
      if (rules.ignoreUnmonitoredProducts && product.reorderLevel === 0) continue
      if (recentAlertsByProductId.has(product.id)) continue

      alerts.push({
        id: `alert-${product.id}-${Date.now()}`,
        category: 'out-of-stock',
        severity: 'critical',
        title: `${product.name} is out of stock`,
        message: `${product.sku} has zero units available.`,
        productId: product.id,
        createdAt: now.toISOString(),
        acknowledged: false,
      })
    }
  }

  if (rules.alertOnLowStock) {
    for (const product of findLowStockProducts(products)) {
      if (rules.ignoreUnmonitoredProducts && product.reorderLevel === 0) continue
      if (recentAlertsByProductId.has(product.id)) continue

      alerts.push({
        id: `alert-${product.id}-${Date.now()}`,
        category: 'low-stock',
        severity: 'warning',
        title: `${product.name} is low on stock`,
        message: `${product.sku} has ${product.quantity} units (reorder level: ${product.reorderLevel}).`,
        productId: product.id,
        createdAt: now.toISOString(),
        acknowledged: false,
      })
    }
  }

  return alerts
}

/**
 * Suggest reorder quantities for low-stock products.
 * Basic strategy: order enough to reach 2x the reorder level.
 */
export function generateReorderSuggestions(
  lowStockProducts: Product[],
  supplierMap: Map<string, { supplierId: string; supplierName: string; unitCost: number }>,
): ReorderSuggestion[] {
  return lowStockProducts.map((product) => {
    const supplier = supplierMap.get(product.id)
    const suggestedQuantity = Math.max(product.reorderLevel, product.reorderLevel * 2 - product.quantity)
    const estimatedTotal = supplier ? suggestedQuantity * supplier.unitCost : undefined

    return {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      currentQuantity: product.quantity,
      reorderLevel: product.reorderLevel,
      suggestedQuantity,
      bestSupplierId: supplier?.supplierId,
      bestSupplierName: supplier?.supplierName,
      unitCost: supplier?.unitCost,
      estimatedTotal,
    }
  })
}

/**
 * Track whether an alert has been recently triggered to avoid spam.
 * Returns true if the alert is within the dedup window.
 */
export function isAlertRecent(alert: Alert, dedupHours: number): boolean {
  if (alert.resolvedAt) return false
  const age = Date.now() - new Date(alert.createdAt).getTime()
  return age < dedupHours * 60 * 60 * 1000
}

/**
 * Calculate how "healthy" an inventory is overall.
 * Score: 0-100 where 100 is perfect.
 */
export function calculateInventoryHealth(
  products: Product[],
  outOfStockCount: number,
  lowStockCount: number,
): number {
  if (products.length === 0) return 100

  const monitoredCount = products.filter((p) => p.reorderLevel > 0).length
  if (monitoredCount === 0) return 100 // Can't rate if nothing is monitored

  const healthyCount = monitoredCount - outOfStockCount - lowStockCount
  const score = Math.round((healthyCount / monitoredCount) * 100)

  return Math.max(0, Math.min(100, score))
}
