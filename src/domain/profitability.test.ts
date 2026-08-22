import { describe, it, expect } from 'vitest'
import { findDeadStock, rollingDateRange } from './profitability'
import type { Product, Sale } from './types'

describe('Profitability', () => {
  const createProduct = (overrides: Partial<Product> = {}): Product => ({
    id: 'p1',
    barcode: '',
    sku: 'SKU-1',
    name: 'Product 1',
    category: 'Test',
    location: 'Shelf',
    variation: '',
    quantity: 10,
    reorderLevel: 5,
    cost: 4,
    price: 10,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  })

  const createSale = (productId: string, createdAt: string, quantity = 1): Sale => ({
    id: `sale-${productId}-${createdAt}`,
    channel: 'Walk-in',
    paymentMethod: 'cash',
    subtotal: 10 * quantity,
    totalCost: 4 * quantity,
    profit: 6 * quantity,
    createdAt,
    lines: [
      {
        id: `line-${productId}-${createdAt}`,
        saleId: `sale-${productId}-${createdAt}`,
        productId,
        sku: 'SKU-1',
        name: 'Product 1',
        quantity,
        unitPrice: 10,
        unitCost: 4,
        lineTotal: 10 * quantity,
        lineProfit: 6 * quantity,
      },
    ],
  })

  describe('rollingDateRange', () => {
    it('spans the requested number of days up to and including now', () => {
      const now = new Date('2026-03-15T12:00:00Z')
      const range = rollingDateRange(30, now)
      expect(range.end).toBe('2026-03-15')
      expect(range.start).toBe('2026-02-13')
    })
  })

  describe('findDeadStock', () => {
    const now = new Date('2026-03-15T00:00:00Z')

    it('flags a product with stock that has not sold in over the threshold', () => {
      const product = createProduct({ id: 'p1', createdAt: '2025-01-01T00:00:00Z' })
      const sales = [createSale('p1', '2025-12-01T00:00:00Z')] // ~104 days before `now`

      const result = findDeadStock([product], sales, now, 60)
      expect(result).toHaveLength(1)
      expect(result[0].productId).toBe('p1')
      expect(result[0].daysSinceLastSale).toBeGreaterThanOrEqual(60)
      expect(result[0].costBasis).toBe(40) // quantity 10 * cost 4
    })

    it('does not flag a product that sold recently', () => {
      const product = createProduct({ id: 'p1' })
      const sales = [createSale('p1', '2026-03-01T00:00:00Z')] // 14 days before `now`

      expect(findDeadStock([product], sales, now, 60)).toHaveLength(0)
    })

    it('does not flag an out-of-stock product (nothing to sell through)', () => {
      const product = createProduct({ id: 'p1', quantity: 0, createdAt: '2025-01-01T00:00:00Z' })
      expect(findDeadStock([product], [], now, 60)).toHaveLength(0)
    })

    it('gives a brand-new never-sold product a fair chance before flagging it', () => {
      const product = createProduct({ id: 'p1', createdAt: '2026-03-10T00:00:00Z' }) // 5 days old
      expect(findDeadStock([product], [], now, 60)).toHaveLength(0)
    })

    it('flags a long-standing product that has never sold at all', () => {
      const product = createProduct({ id: 'p1', createdAt: '2025-01-01T00:00:00Z' })
      const result = findDeadStock([product], [], now, 60)
      expect(result).toHaveLength(1)
      expect(result[0].lastSoldAt).toBeNull()
      expect(result[0].daysSinceLastSale).toBeNull()
    })

    it('ignores sales of a different product', () => {
      const product = createProduct({ id: 'p1', createdAt: '2025-01-01T00:00:00Z' })
      const sales = [createSale('p2', '2026-03-14T00:00:00Z')]
      expect(findDeadStock([product], sales, now, 60)).toHaveLength(1)
    })

    it('orders by cost tied up, most first', () => {
      const cheap = createProduct({ id: 'p1', sku: 'CHEAP', createdAt: '2025-01-01T00:00:00Z', quantity: 5, cost: 1 })
      const expensive = createProduct({
        id: 'p2',
        sku: 'PRICEY',
        createdAt: '2025-01-01T00:00:00Z',
        quantity: 5,
        cost: 100,
      })

      const result = findDeadStock([cheap, expensive], [], now, 60)
      expect(result.map((e) => e.productId)).toEqual(['p2', 'p1'])
    })

    it('uses the last of multiple sales, not the first', () => {
      const product = createProduct({ id: 'p1', createdAt: '2025-01-01T00:00:00Z' })
      const sales = [createSale('p1', '2025-06-01T00:00:00Z'), createSale('p1', '2026-03-10T00:00:00Z')]
      expect(findDeadStock([product], sales, now, 60)).toHaveLength(0)
    })
  })
})
