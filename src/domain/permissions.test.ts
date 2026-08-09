import { describe, expect, it } from 'vitest'
import {
  canApproveStocktake,
  canDeleteProduct,
  isManager,
  productEditNeedsManager,
  returnNeedsManager,
  saleNeedsManager,
} from './permissions'
import type { ReturnCaseInput, SaleInput } from './types'

describe('isManager', () => {
  it('is true only for the manager role', () => {
    expect(isManager('manager')).toBe(true)
    expect(isManager('employee')).toBe(false)
  })
})

describe('canDeleteProduct', () => {
  it('only a manager can delete a product', () => {
    expect(canDeleteProduct('manager')).toBe(true)
    expect(canDeleteProduct('employee')).toBe(false)
  })
})

describe('productEditNeedsManager', () => {
  const existing = { cost: 5, price: 10 }

  it('is false when neither cost nor price changes', () => {
    expect(productEditNeedsManager({ cost: 5, price: 10 }, existing)).toBe(false)
  })

  it('is true when cost changes', () => {
    expect(productEditNeedsManager({ cost: 6, price: 10 }, existing)).toBe(true)
  })

  it('is true when price changes', () => {
    expect(productEditNeedsManager({ cost: 5, price: 11 }, existing)).toBe(true)
  })

  it('is true when creating with no existing row to compare against', () => {
    expect(productEditNeedsManager({ cost: 0, price: 0 }, undefined)).toBe(true)
  })
})

describe('canApproveStocktake', () => {
  it('lets anyone record ordinary stock in/out', () => {
    expect(canApproveStocktake('employee', 'in')).toBe(true)
    expect(canApproveStocktake('employee', 'out')).toBe(true)
  })

  it('requires a manager for an absolute recount adjustment', () => {
    expect(canApproveStocktake('employee', 'adjust')).toBe(false)
    expect(canApproveStocktake('manager', 'adjust')).toBe(true)
  })
})

describe('saleNeedsManager', () => {
  const prices: Record<string, number> = { p1: 10, p2: 20 }
  const priceOf = (id: string): number | undefined => prices[id]

  const sale = (unitPrice: number): SaleInput => ({
    channel: 'Website',
    paymentMethod: 'card',
    lines: [{ productId: 'p1', quantity: 1, unitPrice }],
  })

  it('is false when every line is sold at its listed price', () => {
    expect(saleNeedsManager(sale(10), priceOf)).toBe(false)
  })

  it('is true when a line is discounted below the listed price', () => {
    expect(saleNeedsManager(sale(8), priceOf)).toBe(true)
  })

  it('is true when a line is marked up above the listed price', () => {
    expect(saleNeedsManager(sale(12), priceOf)).toBe(true)
  })

  it('ignores a product it has no listed price for, rather than blocking the sale', () => {
    const sale: SaleInput = {
      channel: '',
      paymentMethod: 'cash',
      lines: [{ productId: 'unknown', quantity: 1, unitPrice: 999 }],
    }
    expect(saleNeedsManager(sale, priceOf)).toBe(false)
  })
})

describe('returnNeedsManager', () => {
  const base: ReturnCaseInput = { actions: [] }

  it('is false for a plain restock with no refund or goodwill', () => {
    const input: ReturnCaseInput = {
      ...base,
      returnLines: [{ productId: 'p1', quantity: 1, disposition: 'restock' }],
    }
    expect(returnNeedsManager(input)).toBe(false)
  })

  it('is true when a refund is involved', () => {
    expect(returnNeedsManager({ ...base, actions: ['refund'] })).toBe(true)
  })

  it('is true when a goodwill gesture is involved', () => {
    expect(returnNeedsManager({ ...base, actions: ['goodwill'] })).toBe(true)
  })

  it('is true when any line is written off', () => {
    const input: ReturnCaseInput = {
      ...base,
      returnLines: [{ productId: 'p1', quantity: 1, disposition: 'writeoff' }],
    }
    expect(returnNeedsManager(input)).toBe(true)
  })

  it('is false for a note-only case with no actions or lines', () => {
    expect(returnNeedsManager(base)).toBe(false)
  })
})
