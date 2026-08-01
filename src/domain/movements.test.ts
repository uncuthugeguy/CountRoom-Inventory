import { describe, expect, it } from 'vitest'
import type { Product } from './types'
import { applyMovement, validateMovement } from './movements'

const product: Product = {
  id: 'p1',
  barcode: '5012345678900',
  sku: 'SKU-1',
  name: 'Widget',
  category: 'Hardware',
  location: 'A1',
  quantity: 10,
  reorderLevel: 4,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('validateMovement', () => {
  it('rejects a non-integer quantity', () => {
    const result = validateMovement(product, { type: 'in', quantity: 2.5 })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toMatch(/whole number/i)
  })

  it('rejects a quantity that is not a finite number', () => {
    const result = validateMovement(product, { type: 'in', quantity: Number.NaN })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toMatch(/whole number/i)
  })

  it('rejects a zero quantity for stock in', () => {
    const result = validateMovement(product, { type: 'in', quantity: 0 })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toMatch(/greater than zero/i)
  })

  it('rejects a negative quantity for stock out', () => {
    const result = validateMovement(product, { type: 'out', quantity: -3 })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toMatch(/greater than zero/i)
  })

  it('rejects a stock out larger than the quantity on hand', () => {
    const result = validateMovement(product, { type: 'out', quantity: 11 })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toMatch(/only 10 in stock/i)
  })

  it('accepts a stock out equal to the quantity on hand', () => {
    expect(validateMovement(product, { type: 'out', quantity: 10 }).ok).toBe(true)
  })

  it('accepts an adjustment to zero', () => {
    expect(validateMovement(product, { type: 'adjust', quantity: 0 }).ok).toBe(true)
  })

  it('rejects an adjustment to a negative count', () => {
    const result = validateMovement(product, { type: 'adjust', quantity: -1 })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toMatch(/cannot be negative/i)
  })

  it('rejects an unknown movement type', () => {
    // @ts-expect-error deliberately invalid movement type
    const result = validateMovement(product, { type: 'teleport', quantity: 1 })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toMatch(/unknown movement type/i)
  })
})

describe('applyMovement quantity calculations', () => {
  it('adds the quantity for a stock in', () => {
    const result = applyMovement(product, { type: 'in', quantity: 5 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.product.quantity).toBe(15)
    expect(result.value.movement.previousQuantity).toBe(10)
    expect(result.value.movement.newQuantity).toBe(15)
    expect(result.value.movement.delta).toBe(5)
  })

  it('subtracts the quantity for a stock out', () => {
    const result = applyMovement(product, { type: 'out', quantity: 4 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.product.quantity).toBe(6)
    expect(result.value.movement.delta).toBe(-4)
  })

  it('sets the absolute count for an adjustment and records the signed delta', () => {
    const result = applyMovement(product, { type: 'adjust', quantity: 3 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.product.quantity).toBe(3)
    expect(result.value.movement.previousQuantity).toBe(10)
    expect(result.value.movement.newQuantity).toBe(3)
    expect(result.value.movement.delta).toBe(-7)
  })

  it('records an upward adjustment as a positive delta', () => {
    const result = applyMovement(product, { type: 'adjust', quantity: 12 })
    expect(result.ok === true && result.value.movement.delta).toBe(2)
  })

  it('never produces a negative quantity on hand', () => {
    const result = applyMovement(product, { type: 'out', quantity: 10 })
    expect(result.ok === true && result.value.product.quantity).toBe(0)
  })

  it('carries the reason and stamps the audit fields', () => {
    const result = applyMovement(
      product,
      { type: 'in', quantity: 2, reason: 'Delivery #42' },
      { id: 'm1', at: '2026-02-02T10:00:00.000Z' },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.movement).toMatchObject({
      id: 'm1',
      productId: 'p1',
      type: 'in',
      quantity: 2,
      reason: 'Delivery #42',
      createdAt: '2026-02-02T10:00:00.000Z',
    })
    expect(result.value.product.updatedAt).toBe('2026-02-02T10:00:00.000Z')
  })

  it('does not mutate the input product', () => {
    applyMovement(product, { type: 'out', quantity: 5 })
    expect(product.quantity).toBe(10)
  })

  it('returns the validation error instead of applying an invalid movement', () => {
    const result = applyMovement(product, { type: 'out', quantity: 999 })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toMatch(/only 10 in stock/i)
  })
})
