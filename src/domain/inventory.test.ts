import { describe, expect, it } from 'vitest'
import type { Product } from './types'
import {
  findByBarcode,
  isLowStock,
  lowStockProducts,
  searchProducts,
  summarise,
} from './inventory'

const make = (overrides: Partial<Product> & { id: string }): Product => ({
  barcode: '',
  sku: '',
  name: '',
  category: '',
  location: '',
  quantity: 0,
  reorderLevel: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

const catalogue: Product[] = [
  make({
    id: 'p1',
    barcode: '5012345678900',
    sku: 'BLT-M6',
    name: 'M6 Bolt',
    category: 'Fasteners',
    location: 'A1',
    quantity: 3,
    reorderLevel: 5,
  }),
  make({
    id: 'p2',
    barcode: '5012345678917',
    sku: 'WSH-M6',
    name: 'M6 Washer',
    category: 'Fasteners',
    location: 'A2',
    quantity: 5,
    reorderLevel: 5,
  }),
  make({
    id: 'p3',
    barcode: '0001112223334',
    sku: 'DRL-18V',
    name: 'Cordless Drill',
    category: 'Power Tools',
    location: 'B7',
    quantity: 12,
    reorderLevel: 2,
  }),
  make({
    id: 'p4',
    barcode: '9990001112223',
    sku: 'BAT-18V',
    name: 'Spare Battery',
    category: 'Power Tools',
    location: 'B8',
    quantity: 0,
    reorderLevel: 0,
  }),
]

describe('isLowStock', () => {
  it('is low when the quantity is below the reorder level', () => {
    expect(isLowStock(catalogue[0])).toBe(true)
  })

  it('is low when the quantity is exactly at the reorder level', () => {
    expect(isLowStock(catalogue[1])).toBe(true)
  })

  it('is not low when the quantity is above the reorder level', () => {
    expect(isLowStock(catalogue[2])).toBe(false)
  })

  it('is not low when the reorder level is zero and stock is zero', () => {
    expect(isLowStock(catalogue[3])).toBe(false)
  })

  it('lists every low stock product', () => {
    expect(lowStockProducts(catalogue).map((p) => p.id)).toEqual(['p1', 'p2'])
  })
})

describe('summarise', () => {
  it('totals products, units and low stock lines', () => {
    expect(summarise(catalogue)).toEqual({
      totalProducts: 4,
      totalUnits: 20,
      lowStockCount: 2,
      outOfStockCount: 1,
    })
  })

  it('handles an empty catalogue', () => {
    expect(summarise([])).toEqual({
      totalProducts: 0,
      totalUnits: 0,
      lowStockCount: 0,
      outOfStockCount: 0,
    })
  })
})

describe('findByBarcode', () => {
  it('finds a product by exact barcode', () => {
    expect(findByBarcode(catalogue, '0001112223334')?.id).toBe('p3')
  })

  it('trims scanner whitespace and carriage returns before matching', () => {
    expect(findByBarcode(catalogue, ' 0001112223334\r\n')?.id).toBe('p3')
  })

  it('returns undefined for an unknown barcode', () => {
    expect(findByBarcode(catalogue, '404')).toBeUndefined()
  })

  it('returns undefined for an empty barcode rather than matching a blank field', () => {
    expect(findByBarcode([make({ id: 'blank', barcode: '' })], '  ')).toBeUndefined()
  })
})

describe('searchProducts', () => {
  it('returns every product for an empty query', () => {
    expect(searchProducts(catalogue, '   ')).toHaveLength(4)
  })

  it('matches on name regardless of case', () => {
    expect(searchProducts(catalogue, 'drill').map((p) => p.id)).toEqual(['p3'])
  })

  it('matches on sku fragment', () => {
    expect(searchProducts(catalogue, '18v').map((p) => p.id)).toEqual(['p3', 'p4'])
  })

  it('matches on barcode, category and location', () => {
    expect(searchProducts(catalogue, '9990001112223').map((p) => p.id)).toEqual(['p4'])
    expect(searchProducts(catalogue, 'fasteners').map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(searchProducts(catalogue, 'b7').map((p) => p.id)).toEqual(['p3'])
  })

  it('returns an empty list when nothing matches', () => {
    expect(searchProducts(catalogue, 'zzzz')).toEqual([])
  })
})
