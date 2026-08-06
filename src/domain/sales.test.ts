import { describe, expect, it } from 'vitest'
import type { Product, Sale } from './types'
import {
  addToCart,
  breakdownByChannel,
  breakdownByPaymentMethod,
  breakdownByProduct,
  buildSaleInput,
  cartHasIssues,
  cartLineIssue,
  cartTotals,
  removeFromCart,
  salesSince,
  setCartPrice,
  setCartQuantity,
  summariseSales,
} from './sales'

const product = (overrides: Partial<Product> & { id: string }): Product => ({
  barcode: '',
  sku: '',
  name: '',
  category: '',
  location: '',
  variation: '',
  quantity: 10,
  reorderLevel: 0,
  cost: 2,
  price: 5,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

const bolt = product({ id: 'p1', sku: 'BLT-M6', name: 'M6 Bolt', quantity: 10, cost: 2, price: 5 })
const washer = product({
  id: 'p2',
  sku: 'WSH-M6',
  name: 'M6 Washer',
  quantity: 3,
  cost: 0.5,
  price: 1.5,
})

describe('addToCart', () => {
  it('adds a new line with quantity 1 at the product default price', () => {
    const cart = addToCart([], bolt)
    expect(cart).toEqual([{ product: bolt, quantity: 1, unitPrice: 5 }])
  })

  it('increments the quantity when the product is already in the cart', () => {
    const cart = addToCart(addToCart([], bolt), bolt)
    expect(cart).toHaveLength(1)
    expect(cart[0].quantity).toBe(2)
  })

  it('keeps a manually overridden price when incrementing', () => {
    const cart = setCartPrice(addToCart([], bolt), bolt.id, 4)
    const next = addToCart(cart, bolt)
    expect(next[0]).toMatchObject({ quantity: 2, unitPrice: 4 })
  })
})

describe('setCartQuantity / removeFromCart', () => {
  it('sets an explicit quantity', () => {
    const cart = setCartQuantity(addToCart([], bolt), bolt.id, 7)
    expect(cart[0].quantity).toBe(7)
  })

  it('removes the line when the quantity drops to zero or below', () => {
    const cart = addToCart([], bolt)
    expect(setCartQuantity(cart, bolt.id, 0)).toEqual([])
    expect(setCartQuantity(cart, bolt.id, -1)).toEqual([])
  })

  it('removeFromCart drops only the targeted line', () => {
    const cart = addToCart(addToCart([], bolt), washer)
    expect(removeFromCart(cart, bolt.id).map((l) => l.product.id)).toEqual([washer.id])
  })
})

describe('cartTotals', () => {
  it('sums quantity, subtotal, cost and profit across lines', () => {
    const cart = setCartQuantity(addToCart(addToCart([], bolt), washer), bolt.id, 3)
    expect(cartTotals(cart)).toEqual({
      itemCount: 4,
      subtotal: 3 * 5 + 1 * 1.5,
      totalCost: 3 * 2 + 1 * 0.5,
      profit: 3 * (5 - 2) + 1 * (1.5 - 0.5),
    })
  })

  it('returns zeroes for an empty cart', () => {
    expect(cartTotals([])).toEqual({ itemCount: 0, subtotal: 0, totalCost: 0, profit: 0 })
  })
})

describe('cartLineIssue / cartHasIssues', () => {
  it('flags a line that wants more than is on hand', () => {
    const cart = setCartQuantity(addToCart([], washer), washer.id, 5)
    expect(cartLineIssue(cart[0])).toMatch(/only 3 in stock/i)
    expect(cartHasIssues(cart)).toBe(true)
  })

  it('has no issue when every line is within stock', () => {
    const cart = addToCart(addToCart([], bolt), washer)
    expect(cartHasIssues(cart)).toBe(false)
  })
})

describe('buildSaleInput', () => {
  it('maps cart lines and trims the channel', () => {
    const cart = addToCart([], bolt)
    expect(buildSaleInput(cart, '  eBay  ', 'card')).toEqual({
      channel: 'eBay',
      paymentMethod: 'card',
      lines: [{ productId: bolt.id, quantity: 1, unitPrice: 5 }],
    })
  })
})

const sale = (overrides: Partial<Sale> & { id: string }): Sale => ({
  channel: 'eBay',
  paymentMethod: 'card',
  subtotal: 10,
  totalCost: 4,
  profit: 6,
  createdAt: '2026-01-15T12:00:00.000Z',
  lines: [],
  ...overrides,
})

describe('summariseSales', () => {
  it('totals sale count, items, revenue, cost and profit', () => {
    const sales = [
      sale({
        id: 's1',
        subtotal: 10,
        totalCost: 4,
        profit: 6,
        lines: [
          {
            id: 'l1',
            saleId: 's1',
            productId: 'p1',
            sku: 'BLT-M6',
            name: 'Bolt',
            quantity: 2,
            unitPrice: 5,
            unitCost: 2,
            lineTotal: 10,
            lineProfit: 6,
          },
        ],
      }),
      sale({ id: 's2', subtotal: 20, totalCost: 8, profit: 12, lines: [] }),
    ]
    expect(summariseSales(sales)).toEqual({
      saleCount: 2,
      itemsSold: 2,
      revenue: 30,
      cost: 12,
      profit: 18,
    })
  })

  it('returns zeroes for no sales', () => {
    expect(summariseSales([])).toEqual({
      saleCount: 0,
      itemsSold: 0,
      revenue: 0,
      cost: 0,
      profit: 0,
    })
  })
})

describe('salesSince', () => {
  it('keeps sales at or after the cutoff', () => {
    const sales = [
      sale({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' }),
      sale({ id: 'new', createdAt: '2026-01-20T00:00:00.000Z' }),
    ]
    expect(salesSince(sales, new Date('2026-01-10T00:00:00.000Z')).map((s) => s.id)).toEqual([
      'new',
    ])
  })
})

describe('breakdownByChannel / breakdownByPaymentMethod', () => {
  const sales = [
    sale({ id: 's1', channel: 'eBay', paymentMethod: 'card', subtotal: 30, profit: 10 }),
    sale({ id: 's2', channel: 'eBay', paymentMethod: 'cash', subtotal: 10, profit: 4 }),
    sale({ id: 's3', channel: 'Website', paymentMethod: 'card', subtotal: 50, profit: 20 }),
  ]

  it('groups by channel, sorted by revenue descending', () => {
    expect(breakdownByChannel(sales)).toEqual([
      { key: 'Website', count: 1, revenue: 50, profit: 20 },
      { key: 'eBay', count: 2, revenue: 40, profit: 14 },
    ])
  })

  it('groups by payment method', () => {
    expect(breakdownByPaymentMethod(sales)).toEqual([
      { key: 'card', count: 2, revenue: 80, profit: 30 },
      { key: 'cash', count: 1, revenue: 10, profit: 4 },
    ])
  })

  it('labels a blank channel as unspecified', () => {
    const blank = [sale({ id: 's4', channel: '', subtotal: 5, profit: 1 })]
    expect(breakdownByChannel(blank)).toEqual([
      { key: 'Unspecified', count: 1, revenue: 5, profit: 1 },
    ])
  })
})

describe('breakdownByProduct', () => {
  it('sums units, revenue and profit per SKU across sales, sorted by units sold', () => {
    const sales = [
      sale({
        id: 's1',
        lines: [
          {
            id: 'l1',
            saleId: 's1',
            productId: 'p1',
            sku: 'BLT-M6',
            name: 'M6 Bolt',
            quantity: 2,
            unitPrice: 5,
            unitCost: 2,
            lineTotal: 10,
            lineProfit: 6,
          },
          {
            id: 'l2',
            saleId: 's1',
            productId: 'p2',
            sku: 'WSH-M6',
            name: 'M6 Washer',
            quantity: 1,
            unitPrice: 1.5,
            unitCost: 0.5,
            lineTotal: 1.5,
            lineProfit: 1,
          },
        ],
      }),
      sale({
        id: 's2',
        lines: [
          {
            id: 'l3',
            saleId: 's2',
            productId: 'p1',
            sku: 'BLT-M6',
            name: 'M6 Bolt',
            quantity: 5,
            unitPrice: 5,
            unitCost: 2,
            lineTotal: 25,
            lineProfit: 15,
          },
        ],
      }),
    ]

    expect(breakdownByProduct(sales)).toEqual([
      { name: 'M6 Bolt', sku: 'BLT-M6', unitsSold: 7, revenue: 35, profit: 21 },
      { name: 'M6 Washer', sku: 'WSH-M6', unitsSold: 1, revenue: 1.5, profit: 1 },
    ])
  })

  it('returns an empty list for no sales', () => {
    expect(breakdownByProduct([])).toEqual([])
  })
})
