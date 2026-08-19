import { describe, it, expect } from 'vitest'
import {
  findLowStockProducts,
  findOutOfStockProducts,
  generateStockAlerts,
  generateReorderSuggestions,
  isAlertRecent,
  calculateInventoryHealth,
  DEFAULT_ALERT_RULES,
} from './alerts'
import type { Alert } from './alerts'
import type { Product } from './types'

describe('Alerts', () => {
  const createProduct = (
    id: string,
    quantity: number,
    reorderLevel: number = 10,
  ): Product => ({
    id,
    barcode: '',
    sku: `SKU-${id}`,
    name: `Product ${id}`,
    category: 'Test',
    location: 'Shelf',
    variation: '',
    quantity,
    reorderLevel,
    cost: 10,
    price: 25,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  })

  describe('findLowStockProducts', () => {
    it('identifies products at or below reorder level', () => {
      const products = [
        createProduct('p1', 5, 10), // Below
        createProduct('p2', 10, 10), // At
        createProduct('p3', 15, 10), // Above
        createProduct('p4', 0, 10), // Out of stock
        createProduct('p5', 5, 0), // No reorder level
      ]

      const result = findLowStockProducts(products)
      expect(result.map((p) => p.id)).toEqual(['p1', 'p2'])
    })

    it('excludes products with zero reorder level', () => {
      const products = [
        createProduct('p1', 2, 0),
        createProduct('p2', 2, 5),
      ]

      const result = findLowStockProducts(products)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('p2')
    })

    it('excludes out-of-stock products', () => {
      const products = [
        createProduct('p1', 0, 5),
        createProduct('p2', 3, 5),
      ]

      const result = findLowStockProducts(products)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('p2')
    })
  })

  describe('findOutOfStockProducts', () => {
    it('identifies products with zero quantity', () => {
      const products = [
        createProduct('p1', 0),
        createProduct('p2', 1),
        createProduct('p3', 0),
      ]

      const result = findOutOfStockProducts(products)
      expect(result.map((p) => p.id)).toEqual(['p1', 'p3'])
    })
  })

  describe('generateStockAlerts', () => {
    const createAlert = (id: string, productId: string, age: number): Alert => ({
      id,
      category: 'low-stock',
      severity: 'warning',
      title: 'Low stock',
      message: 'Low stock alert',
      productId,
      createdAt: new Date(Date.now() - age).toISOString(),
      acknowledged: false,
    })

    it('generates alerts for low-stock products', () => {
      const products = [
        createProduct('p1', 5, 10),
        createProduct('p2', 15, 10),
      ]

      const alerts = generateStockAlerts(products, [], DEFAULT_ALERT_RULES)
      expect(alerts).toHaveLength(1)
      expect(alerts[0].productId).toBe('p1')
      expect(alerts[0].category).toBe('low-stock')
    })

    it('generates alerts for out-of-stock products', () => {
      const products = [createProduct('p1', 0, 10)]

      const alerts = generateStockAlerts(products, [], DEFAULT_ALERT_RULES)
      expect(alerts).toHaveLength(1)
      expect(alerts[0].category).toBe('out-of-stock')
      expect(alerts[0].severity).toBe('critical')
    })

    it('respects dedup window to avoid duplicate alerts', () => {
      const products = [createProduct('p1', 5, 10)]
      const recentAlert = createAlert('old-1', 'p1', 1 * 60 * 60 * 1000) // 1 hour ago
      const rules = { ...DEFAULT_ALERT_RULES, alertDedupHours: 4 }

      const alerts = generateStockAlerts(products, [recentAlert], rules)
      expect(alerts).toHaveLength(0) // Deduped
    })

    it('generates new alert when dedup window expires', () => {
      const products = [createProduct('p1', 5, 10)]
      const oldAlert = createAlert('old-1', 'p1', 5 * 60 * 60 * 1000) // 5 hours ago
      const rules = { ...DEFAULT_ALERT_RULES, alertDedupHours: 4 }

      const alerts = generateStockAlerts(products, [oldAlert], rules)
      expect(alerts).toHaveLength(1) // Not deduped
    })

    it('ignores resolved alerts', () => {
      const products = [createProduct('p1', 5, 10)]
      const resolvedAlert: Alert = {
        id: 'resolved-1',
        category: 'low-stock',
        severity: 'warning',
        title: '',
        message: '',
        productId: 'p1',
        createdAt: new Date(Date.now() - 1000).toISOString(),
        resolvedAt: new Date().toISOString(),
        acknowledged: true,
      }

      const alerts = generateStockAlerts(products, [resolvedAlert], DEFAULT_ALERT_RULES)
      expect(alerts).toHaveLength(1) // New alert generated
    })

    it('respects ignoreUnmonitoredProducts rule', () => {
      const products = [
        createProduct('p1', 5, 0), // No reorder level
        createProduct('p2', 5, 10), // Has reorder level
      ]
      const rules = { ...DEFAULT_ALERT_RULES, ignoreUnmonitoredProducts: true }

      const alerts = generateStockAlerts(products, [], rules)
      expect(alerts).toHaveLength(1)
      expect(alerts[0].productId).toBe('p2')
    })

    it('can disable out-of-stock alerts', () => {
      const products = [createProduct('p1', 0, 10)]
      const rules = { ...DEFAULT_ALERT_RULES, alertOnOutOfStock: false }

      const alerts = generateStockAlerts(products, [], rules)
      expect(alerts).toHaveLength(0)
    })
  })

  describe('generateReorderSuggestions', () => {
    it('suggests reorder quantity based on reorder level', () => {
      const products = [createProduct('p1', 5, 10)]
      const supplierMap = new Map()

      const suggestions = generateReorderSuggestions(products, supplierMap)
      expect(suggestions).toHaveLength(1)
      expect(suggestions[0].suggestedQuantity).toBe(15) // 2x reorder level - current qty
    })

    it('includes supplier info when available', () => {
      const products = [createProduct('p1', 5, 10)]
      const supplierMap = new Map([
        [
          'p1',
          {
            supplierId: 's1',
            supplierName: 'Supplier A',
            unitCost: 5,
          },
        ],
      ])

      const suggestions = generateReorderSuggestions(products, supplierMap)
      expect(suggestions[0].bestSupplierId).toBe('s1')
      expect(suggestions[0].estimatedTotal).toBe(75) // 15 * 5
    })
  })

  describe('isAlertRecent', () => {
    it('returns true for recent alerts', () => {
      const alert: Alert = {
        id: '1',
        category: 'low-stock',
        severity: 'warning',
        title: '',
        message: '',
        createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // 1 hour ago
        acknowledged: false,
      }

      expect(isAlertRecent(alert, 4)).toBe(true)
    })

    it('returns false for old alerts', () => {
      const alert: Alert = {
        id: '1',
        category: 'low-stock',
        severity: 'warning',
        title: '',
        message: '',
        createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), // 5 hours ago
        acknowledged: false,
      }

      expect(isAlertRecent(alert, 4)).toBe(false)
    })

    it('returns false for resolved alerts', () => {
      const alert: Alert = {
        id: '1',
        category: 'low-stock',
        severity: 'warning',
        title: '',
        message: '',
        createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
        resolvedAt: new Date().toISOString(),
        acknowledged: true,
      }

      expect(isAlertRecent(alert, 4)).toBe(false)
    })
  })

  describe('calculateInventoryHealth', () => {
    it('returns 100 for empty inventory', () => {
      expect(calculateInventoryHealth([], 0, 0)).toBe(100)
    })

    it('returns 100 when no products are monitored', () => {
      const products = [
        createProduct('p1', 5, 0),
        createProduct('p2', 10, 0),
      ]
      expect(calculateInventoryHealth(products, 0, 0)).toBe(100)
    })

    it('calculates health based on monitored products', () => {
      const products = [
        createProduct('p1', 5, 10), // Monitored
        createProduct('p2', 15, 10), // Monitored
        createProduct('p3', 5, 0), // Not monitored
      ]
      // 2 monitored, 0 out of stock, 1 low stock = 1 healthy out of 2
      expect(calculateInventoryHealth(products, 0, 1)).toBe(50)
    })

    it('returns 0 when all monitored products are problematic', () => {
      const products = [
        createProduct('p1', 0, 10),
        createProduct('p2', 5, 10),
      ]
      // 2 monitored, 1 out of stock, 1 low stock = 0 healthy
      expect(calculateInventoryHealth(products, 1, 1)).toBe(0)
    })

    it('clamps score between 0 and 100', () => {
      const products = [createProduct('p1', 100, 10)]
      expect(calculateInventoryHealth(products, 0, 0)).toBe(100)
      expect(calculateInventoryHealth(products, 1, 1)).toBe(0)
    })
  })
})
