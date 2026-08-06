import { describe, expect, it } from 'vitest'
import type { Product, ReturnCase } from './types'
import {
  addReplacementLine,
  addReturnLine,
  breakdownByAction,
  buildReturnCaseInput,
  emptyReplacementCart,
  emptyReturnCart,
  removeReplacementLine,
  removeReturnLine,
  replacementCartHasIssues,
  replacementLineIssue,
  returnImpact,
  returnsSince,
  setReplacementLineQuantity,
  setReturnLineDisposition,
  setReturnLineQuantity,
  summariseReturns,
  validateReplacementLineInput,
  validateReturnCaseInput,
  validateReturnLineInput,
  type ReturnCaseDraft,
} from './returns'

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
const washer = product({ id: 'p2', sku: 'WSH-M6', name: 'M6 Washer', quantity: 3, cost: 0.5, price: 1.5 })

const baseDraft: ReturnCaseDraft = {
  saleId: '',
  channel: '',
  customerRef: '',
  reason: '',
  notes: '',
  actions: [],
  refundAmount: null,
  refundMethod: 'cash',
  goodwillType: '',
  goodwillValue: null,
}

describe('return cart', () => {
  it('adds a line at quantity 1, restocking by default', () => {
    const cart = addReturnLine(emptyReturnCart(), bolt)
    expect(cart).toEqual([{ product: bolt, quantity: 1, disposition: 'restock' }])
  })

  it('does not duplicate a product already in the cart', () => {
    const cart = addReturnLine(addReturnLine(emptyReturnCart(), bolt), bolt)
    expect(cart).toHaveLength(1)
  })

  it('sets an explicit quantity, and removes the line at zero or below', () => {
    const cart = setReturnLineQuantity(addReturnLine(emptyReturnCart(), bolt), bolt.id, 4)
    expect(cart[0].quantity).toBe(4)
    expect(setReturnLineQuantity(cart, bolt.id, 0)).toEqual([])
  })

  it('toggles disposition between restock and writeoff', () => {
    const cart = setReturnLineDisposition(addReturnLine(emptyReturnCart(), bolt), bolt.id, 'writeoff')
    expect(cart[0].disposition).toBe('writeoff')
  })

  it('removeReturnLine drops only the targeted line', () => {
    const cart = addReturnLine(addReturnLine(emptyReturnCart(), bolt), washer)
    expect(removeReturnLine(cart, bolt.id).map((l) => l.product.id)).toEqual([washer.id])
  })
})

describe('replacement cart', () => {
  it('adds a line at quantity 1', () => {
    const cart = addReplacementLine(emptyReplacementCart(), bolt)
    expect(cart).toEqual([{ product: bolt, quantity: 1 }])
  })

  it('sets an explicit quantity, and removes the line at zero or below', () => {
    const cart = setReplacementLineQuantity(addReplacementLine(emptyReplacementCart(), bolt), bolt.id, 3)
    expect(cart[0].quantity).toBe(3)
    expect(setReplacementLineQuantity(cart, bolt.id, 0)).toEqual([])
  })

  it('removeReplacementLine drops only the targeted line', () => {
    const cart = addReplacementLine(addReplacementLine(emptyReplacementCart(), bolt), washer)
    expect(removeReplacementLine(cart, bolt.id).map((l) => l.product.id)).toEqual([washer.id])
  })

  it('flags a line that wants more than is on hand', () => {
    const cart = setReplacementLineQuantity(addReplacementLine(emptyReplacementCart(), washer), washer.id, 9)
    expect(replacementLineIssue(cart[0])).toMatch(/only 3 in stock/i)
    expect(replacementCartHasIssues(cart)).toBe(true)
  })

  it('has no issue when the line is within stock', () => {
    const cart = addReplacementLine(emptyReplacementCart(), bolt)
    expect(replacementCartHasIssues(cart)).toBe(false)
  })
})

describe('buildReturnCaseInput', () => {
  it('drops fields for an action the user did not select', () => {
    const input = buildReturnCaseInput(emptyReturnCart(), emptyReplacementCart(), {
      ...baseDraft,
      actions: ['return'],
      refundAmount: 12,
      goodwillValue: 5,
    })
    expect(input.refundAmount).toBeUndefined()
    expect(input.refundMethod).toBeUndefined()
    expect(input.goodwillValue).toBeUndefined()
    expect(input.goodwillType).toBeUndefined()
  })

  it('keeps refund and goodwill fields when their action is selected', () => {
    const input = buildReturnCaseInput(emptyReturnCart(), emptyReplacementCart(), {
      ...baseDraft,
      actions: ['refund', 'goodwill'],
      refundAmount: 12,
      refundMethod: 'card',
      goodwillType: 'Voucher',
      goodwillValue: 5,
    })
    expect(input.refundAmount).toBe(12)
    expect(input.refundMethod).toBe('card')
    expect(input.goodwillType).toBe('Voucher')
    expect(input.goodwillValue).toBe(5)
  })

  it('maps cart lines and trims text fields', () => {
    const returnCart = addReturnLine(emptyReturnCart(), bolt)
    const replacementCart = addReplacementLine(emptyReplacementCart(), washer)
    const input = buildReturnCaseInput(returnCart, replacementCart, {
      ...baseDraft,
      saleId: '  sale-1  ',
      channel: '  eBay  ',
      reason: '  Faulty  ',
    })
    expect(input.saleId).toBe('sale-1')
    expect(input.channel).toBe('eBay')
    expect(input.reason).toBe('Faulty')
    expect(input.returnLines).toEqual([{ productId: bolt.id, quantity: 1, disposition: 'restock' }])
    expect(input.replacementLines).toEqual([{ productId: washer.id, quantity: 1 }])
  })

  it('leaves optional text fields undefined when blank', () => {
    const input = buildReturnCaseInput(emptyReturnCart(), emptyReplacementCart(), baseDraft)
    expect(input.saleId).toBeUndefined()
    expect(input.channel).toBeUndefined()
    expect(input.customerRef).toBeUndefined()
    expect(input.reason).toBeUndefined()
    expect(input.notes).toBeUndefined()
  })
})

describe('validateReturnLineInput / validateReplacementLineInput', () => {
  it('rejects a non-positive or fractional quantity', () => {
    expect(validateReturnLineInput({ productId: 'p1', quantity: 0, disposition: 'restock' })).toMatch(/whole number/i)
    expect(validateReturnLineInput({ productId: 'p1', quantity: 1.5, disposition: 'restock' })).toMatch(
      /whole number/i,
    )
    expect(validateReplacementLineInput({ productId: 'p1', quantity: -1 })).toMatch(/whole number/i)
  })

  it('accepts a valid quantity', () => {
    expect(validateReturnLineInput({ productId: 'p1', quantity: 2, disposition: 'writeoff' })).toBeNull()
    expect(validateReplacementLineInput({ productId: 'p1', quantity: 2 })).toBeNull()
  })
})

describe('validateReturnCaseInput', () => {
  it('rejects a case with nothing recorded at all', () => {
    const result = validateReturnCaseInput({ actions: [] })
    expect(result.ok === false && result.error).toMatch(/at least one action/i)
  })

  it('accepts a note-only case with no items or actions', () => {
    const result = validateReturnCaseInput({ actions: [], reason: 'Customer called to complain' })
    expect(result.ok).toBe(true)
  })

  it('accepts a goodwill-only case with no item involved', () => {
    const result = validateReturnCaseInput({ actions: ['goodwill'], goodwillValue: 5 })
    expect(result.ok).toBe(true)
  })

  it('rejects an invalid return line', () => {
    const result = validateReturnCaseInput({
      actions: ['return'],
      returnLines: [{ productId: 'p1', quantity: 0, disposition: 'restock' }],
    })
    expect(result.ok).toBe(false)
  })

  it('rejects a negative refund or goodwill value', () => {
    expect(validateReturnCaseInput({ actions: ['refund'], refundAmount: -1 }).ok).toBe(false)
    expect(validateReturnCaseInput({ actions: ['goodwill'], goodwillValue: -1 }).ok).toBe(false)
  })
})

const returnCase = (overrides: Partial<ReturnCase> & { id: string }): ReturnCase => ({
  saleId: '',
  channel: '',
  customerRef: '',
  reason: '',
  notes: '',
  actions: [],
  refundAmount: 0,
  refundMethod: null,
  goodwillType: '',
  goodwillValue: 0,
  returnLines: [],
  replacementLines: [],
  createdAt: '2026-01-15T12:00:00.000Z',
  ...overrides,
})

describe('returnImpact', () => {
  it('sums refund, goodwill, write-off loss and replacement cost', () => {
    const rc = returnCase({
      id: 'r1',
      refundAmount: 10,
      goodwillValue: 5,
      returnLines: [
        { id: 'l1', returnId: 'r1', productId: 'p1', sku: 'BLT', name: 'Bolt', quantity: 2, disposition: 'writeoff', unitCost: 2 },
        { id: 'l2', returnId: 'r1', productId: 'p2', sku: 'WSH', name: 'Washer', quantity: 3, disposition: 'restock', unitCost: 0.5 },
      ],
      replacementLines: [
        { id: 'l3', returnId: 'r1', productId: 'p3', sku: 'NUT', name: 'Nut', quantity: 1, unitCost: 1 },
      ],
    })
    expect(returnImpact(rc)).toEqual({
      refundTotal: 10,
      goodwillTotal: 5,
      writeOffLoss: 4,
      replacementCost: 1,
      totalCost: 20,
    })
  })
})

describe('summariseReturns / returnsSince / breakdownByAction', () => {
  const cases = [
    returnCase({
      id: 'r1',
      createdAt: '2026-01-01T00:00:00.000Z',
      actions: ['refund', 'return'],
      refundAmount: 10,
      returnLines: [
        { id: 'l1', returnId: 'r1', productId: 'p1', sku: 'BLT', name: 'Bolt', quantity: 2, disposition: 'restock', unitCost: 2 },
      ],
    }),
    returnCase({
      id: 'r2',
      createdAt: '2026-01-20T00:00:00.000Z',
      actions: ['goodwill'],
      goodwillValue: 5,
    }),
  ]

  it('totals cases, refunds, goodwill and restocked/written-off items', () => {
    expect(summariseReturns(cases)).toEqual({
      caseCount: 2,
      refundTotal: 10,
      goodwillTotal: 5,
      writeOffLoss: 0,
      replacementCost: 0,
      totalCost: 15,
      itemsRestocked: 2,
      itemsWrittenOff: 0,
    })
  })

  it('returns zeroes for no cases', () => {
    expect(summariseReturns([])).toEqual({
      caseCount: 0,
      refundTotal: 0,
      goodwillTotal: 0,
      writeOffLoss: 0,
      replacementCost: 0,
      totalCost: 0,
      itemsRestocked: 0,
      itemsWrittenOff: 0,
    })
  })

  it('keeps cases at or after the cutoff', () => {
    expect(returnsSince(cases, new Date('2026-01-10T00:00:00.000Z')).map((rc) => rc.id)).toEqual(['r2'])
  })

  it('counts actions across cases, including those never used', () => {
    expect(breakdownByAction(cases)).toEqual({ refund: 1, return: 1, replacement: 0, goodwill: 1 })
  })
})
