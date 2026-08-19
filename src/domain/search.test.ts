import { describe, it, expect } from 'vitest'
import {
  searchAndFilterProducts,
  getFilterOptions,
  calculateFilterStats,
  sortProducts,
  paginateProducts,
} from './search'
import type { ProductFilter } from './search'
import type { Product } from './types'

describe('Advanced Search & Filtering', () => {
  const createProduct = (overrides: Partial<Product> = {}): Product => ({
    id: 'p1',
    barcode: 'BAR123',
    sku: 'SKU-001',
    name: 'Widget Pro',
    category: 'Electronics',
    location: 'Shelf A',
    variation: 'Blue',
    quantity: 10,
    reorderLevel: 5,
    cost: 10,
    price: 25,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-08-10T00:00:00Z',
    ...overrides,
  })

  const products: Product[] = [
    createProduct({ id: 'p1', name: 'Widget Pro', sku: 'SKU-001', barcode: 'BAR001', category: 'Electronics', quantity: 10, reorderLevel: 0, price: 25, cost: 10 }),
    createProduct({ id: 'p2', name: 'Gadget Plus', sku: 'SKU-002', barcode: 'BAR002', category: 'Electronics', quantity: 0, reorderLevel: 0, price: 15, cost: 8 }),
    createProduct({ id: 'p3', name: 'Tool Deluxe', sku: 'SKU-003', barcode: 'BAR003', category: 'Tools', quantity: 3, reorderLevel: 5, price: 50, cost: 40 }),
    createProduct({ id: 'p4', name: 'Cable Standard', sku: 'SKU-004', barcode: 'BAR004', category: 'Accessories', quantity: 50, reorderLevel: 0, price: 5, cost: 1 }),
    createProduct({ id: 'p5', name: 'Widget Lite', sku: 'SKU-005', barcode: 'BAR005', category: 'Electronics', quantity: 0, reorderLevel: 0, price: 12, cost: 12 }),
  ]

  describe('searchAndFilterProducts', () => {
    it('performs text search across multiple fields', () => {
      const filter: ProductFilter = { search: 'widget' }
      const results = searchAndFilterProducts(products, filter)
      expect(results).toHaveLength(2)
      expect(results.map((p) => p.id)).toContain('p1')
      expect(results.map((p) => p.id)).toContain('p5')
    })

    it('searches by barcode', () => {
      const filter: ProductFilter = { search: 'BAR001' }
      const results = searchAndFilterProducts(products, filter)
      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('p1')
    })

    it('performs case-insensitive search by default', () => {
      const filter: ProductFilter = { search: 'WIDGET' }
      const results = searchAndFilterProducts(products, filter)
      expect(results).toHaveLength(2)
    })

    it('performs case-sensitive search when requested', () => {
      const filter: ProductFilter = { search: 'WIDGET', caseSensitive: true }
      const results = searchAndFilterProducts(products, filter)
      expect(results).toHaveLength(0)
    })

    it('filters by category', () => {
      const filter: ProductFilter = { categories: ['Electronics'] }
      const results = searchAndFilterProducts(products, filter)
      expect(results).toHaveLength(3)
    })

    it('filters by multiple categories', () => {
      const filter: ProductFilter = { categories: ['Electronics', 'Tools'] }
      const results = searchAndFilterProducts(products, filter)
      expect(results).toHaveLength(4)
    })

    it('filters by stock status - in-stock', () => {
      const filter: ProductFilter = { stockStatus: 'in-stock' }
      const results = searchAndFilterProducts(products, filter)
      expect(results.every((p) => p.quantity > 0 && !(p.reorderLevel > 0 && p.quantity <= p.reorderLevel))).toBe(true)
    })

    it('filters by stock status - low-stock', () => {
      const filter: ProductFilter = { stockStatus: 'low-stock' }
      const results = searchAndFilterProducts(products, filter)
      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('p3')
    })

    it('filters by stock status - out-of-stock', () => {
      const filter: ProductFilter = { stockStatus: 'out-of-stock' }
      const results = searchAndFilterProducts(products, filter)
      expect(results).toHaveLength(2)
    })

    it('filters by price range', () => {
      const filter: ProductFilter = { priceRange: { min: 10, max: 30 } }
      const results = searchAndFilterProducts(products, filter)
      expect(results.length).toBeGreaterThan(0)
      expect(results.every((p) => p.price >= 10 && p.price <= 30)).toBe(true)
    })

    it('filters by margin range', () => {
      const filter: ProductFilter = { marginRange: { min: 50, max: 100 } }
      const results = searchAndFilterProducts(products, filter)
      expect(results.length).toBeGreaterThan(0)
      expect(results.every((p) => {
        const margin = ((p.price - p.cost) / p.price) * 100
        return margin >= 50 && margin <= 100
      })).toBe(true)
    })

    it('filters by monitored status', () => {
      const filter: ProductFilter = { monitored: true }
      const results = searchAndFilterProducts(products, filter)
      expect(results.every((p) => p.reorderLevel > 0)).toBe(true)
    })

    it('filters low-margin items', () => {
      const filter: ProductFilter = { lowMargin: true }
      const results = searchAndFilterProducts(products, filter)
      expect(results.every((p) => {
        const margin = ((p.price - p.cost) / p.price) * 100
        return margin < 20
      })).toBe(true)
    })

    it('combines multiple filters', () => {
      const filter: ProductFilter = {
        search: 'widget',
        categories: ['Electronics'],
        stockStatus: 'in-stock',
      }
      const results = searchAndFilterProducts(products, filter)
      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('p1')
    })
  })

  describe('getFilterOptions', () => {
    it('returns unique categories', () => {
      const categories = getFilterOptions(products, 'category')
      expect(categories).toContain('Electronics')
      expect(categories).toContain('Tools')
      expect(categories).toContain('Accessories')
    })

    it('returns sorted categories', () => {
      const categories = getFilterOptions(products, 'category')
      const sorted = [...categories].sort()
      expect(categories).toEqual(sorted)
    })

    it('returns unique locations', () => {
      const locations = getFilterOptions(products, 'location')
      expect(locations).toHaveLength(1)
      expect(locations[0]).toBe('Shelf A')
    })
  })

  describe('calculateFilterStats', () => {
    it('calculates correct counts', () => {
      const stats = calculateFilterStats(products)
      expect(stats.totalCount).toBe(5)
      expect(stats.outOfStockCount).toBe(2)
      expect(stats.lowStockCount).toBe(1)
    })

    it('calculates inventory value', () => {
      const stats = calculateFilterStats([createProduct({ id: 'p1', quantity: 10, price: 25, cost: 10 })])
      expect(stats.totalValue).toBe(250)
      expect(stats.totalCost).toBe(100)
      expect(stats.totalProfit).toBe(150)
    })

    it('calculates average margin', () => {
      const stats = calculateFilterStats([
        createProduct({ id: 'p1', quantity: 10, price: 25, cost: 10 }), // 60% margin
      ])
      expect(Math.round(stats.averageMargin)).toBe(60)
    })
  })

  describe('sortProducts', () => {
    it('sorts by name ascending', () => {
      const sorted = sortProducts(products, 'name', 'asc')
      expect(sorted[0].name).toBe('Cable Standard')
      expect(sorted[sorted.length - 1].name).toBe('Widget Pro')
    })

    it('sorts by name descending', () => {
      const sorted = sortProducts(products, 'name', 'desc')
      expect(sorted[0].name).toBe('Widget Pro')
      expect(sorted[sorted.length - 1].name).toBe('Cable Standard')
    })

    it('sorts by quantity', () => {
      const sorted = sortProducts(products, 'quantity', 'asc')
      expect(sorted[0].quantity).toBe(0)
      expect(sorted[sorted.length - 1].quantity).toBe(50)
    })

    it('sorts by price', () => {
      const sorted = sortProducts(products, 'price', 'asc')
      expect(sorted[0].price).toBe(5)
      expect(sorted[sorted.length - 1].price).toBe(50)
    })

    it('sorts by margin', () => {
      const sorted = sortProducts(products, 'margin', 'desc')
      const margins = sorted.map((p) => ((p.price - p.cost) / p.price) * 100)
      for (let i = 0; i < margins.length - 1; i++) {
        expect(margins[i]).toBeGreaterThanOrEqual(margins[i + 1])
      }
    })

    it('sorts by created date', () => {
      const sorted = sortProducts(products, 'created', 'asc')
      for (let i = 0; i < sorted.length - 1; i++) {
        expect(new Date(sorted[i].createdAt).getTime()).toBeLessThanOrEqual(
          new Date(sorted[i + 1].createdAt).getTime(),
        )
      }
    })
  })

  describe('paginateProducts', () => {
    it('returns correct page of results', () => {
      const paginated = paginateProducts(products, 2, 2)
      expect(paginated.results).toHaveLength(2)
      expect(paginated.currentPage).toBe(2)
    })

    it('calculates correct page count', () => {
      const paginated = paginateProducts(products, 1, 2)
      expect(paginated.pages).toBe(3) // 5 products, 2 per page = 3 pages
    })

    it('returns all results on first page', () => {
      const paginated = paginateProducts(products, 1, 10)
      expect(paginated.results).toHaveLength(5)
    })

    it('returns partial last page', () => {
      const paginated = paginateProducts(products, 3, 2)
      expect(paginated.results).toHaveLength(1)
    })
  })
})
