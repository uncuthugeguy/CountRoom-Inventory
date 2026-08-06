import { describe, expect, it } from 'vitest'
import { emptyDraft, knownVariations, nextSku, normaliseDraft, validateDraft } from './products'
import type { Product } from './types'

describe('validateDraft', () => {
  const valid = {
    barcode: '5012345678900',
    sku: 'SKU-1',
    name: 'Widget',
    category: 'Hardware',
    location: 'A1',
    variation: '',
    quantity: 10,
    reorderLevel: 4,
    cost: 2.5,
    price: 6,
  }

  it('accepts a complete draft', () => {
    expect(validateDraft(valid).ok).toBe(true)
  })

  it('allows a blank barcode — not every product has a manufacturer one', () => {
    expect(validateDraft({ ...valid, barcode: '  ' }).ok).toBe(true)
  })

  it('requires a name', () => {
    const result = validateDraft({ ...valid, name: '' })
    expect(result.ok === false && result.error).toMatch(/name is required/i)
  })

  it('requires a sku', () => {
    const result = validateDraft({ ...valid, sku: '' })
    expect(result.ok === false && result.error).toMatch(/sku is required/i)
  })

  it('rejects a negative quantity', () => {
    const result = validateDraft({ ...valid, quantity: -1 })
    expect(result.ok === false && result.error).toMatch(/quantity cannot be negative/i)
  })

  it('rejects a fractional reorder level', () => {
    const result = validateDraft({ ...valid, reorderLevel: 1.5 })
    expect(result.ok === false && result.error).toMatch(/whole number/i)
  })

  it('allows blank category, location and variation', () => {
    expect(validateDraft({ ...valid, category: '', location: '', variation: '' }).ok).toBe(true)
  })

  it('allows a fractional cost and price', () => {
    expect(validateDraft({ ...valid, cost: 2.49, price: 5.99 }).ok).toBe(true)
  })

  it('rejects a negative cost', () => {
    const result = validateDraft({ ...valid, cost: -1 })
    expect(result.ok === false && result.error).toMatch(/cost cannot be negative/i)
  })

  it('rejects a negative price', () => {
    const result = validateDraft({ ...valid, price: -1 })
    expect(result.ok === false && result.error).toMatch(/price cannot be negative/i)
  })

  it('rejects a non-numeric cost or price', () => {
    const result = validateDraft({ ...valid, cost: Number.NaN })
    expect(result.ok === false && result.error).toMatch(/cost must be a number/i)
  })
})

describe('normaliseDraft', () => {
  it('trims every text field', () => {
    const draft = normaliseDraft({
      barcode: ' 5012345678900 \r\n',
      sku: ' sku-1 ',
      name: '  Widget  ',
      category: ' Hardware ',
      location: ' A1 ',
      variation: ' Blue ',
      quantity: 3,
      reorderLevel: 1,
      cost: 1,
      price: 2,
    })
    expect(draft).toEqual({
      barcode: '5012345678900',
      sku: 'sku-1',
      name: 'Widget',
      category: 'Hardware',
      location: 'A1',
      variation: 'Blue',
      quantity: 3,
      reorderLevel: 1,
      cost: 1,
      price: 2,
    })
  })
})

describe('emptyDraft', () => {
  it('starts blank with zero counts', () => {
    expect(emptyDraft()).toEqual({
      barcode: '',
      sku: '',
      name: '',
      category: '',
      location: '',
      variation: '',
      quantity: 0,
      reorderLevel: 0,
      cost: 0,
      price: 0,
    })
  })

  it('pre-fills a scanned barcode', () => {
    expect(emptyDraft('123').barcode).toBe('123')
  })
})

const make = (id: string, sku: string, variation = ''): Product => ({
  id,
  barcode: '',
  sku,
  name: 'Widget',
  category: '',
  location: '',
  variation,
  quantity: 0,
  reorderLevel: 0,
  cost: 0,
  price: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

describe('nextSku', () => {
  it('starts at SKU-001 when nothing follows the pattern', () => {
    expect(nextSku([])).toBe('SKU-001')
    expect(nextSku([make('p1', 'BLT-M6')])).toBe('SKU-001')
  })

  it('continues from the highest existing SKU-NNN', () => {
    const products = [make('p1', 'SKU-005'), make('p2', 'SKU-018'), make('p3', 'SKU-011')]
    expect(nextSku(products)).toBe('SKU-019')
  })

  it('matches case-insensitively', () => {
    expect(nextSku([make('p1', 'sku-007')])).toBe('SKU-008')
  })

  it('pads to three digits', () => {
    expect(nextSku([make('p1', 'SKU-002')])).toBe('SKU-003')
  })
})

describe('knownVariations', () => {
  it('returns distinct, sorted, non-blank variations', () => {
    const products = [
      make('p1', 'SKU-1', 'Blue'),
      make('p2', 'SKU-2', 'Red'),
      make('p3', 'SKU-3', 'Blue'),
      make('p4', 'SKU-4', ''),
    ]
    expect(knownVariations(products)).toEqual(['Blue', 'Red'])
  })

  it('returns an empty list when no product has a variation', () => {
    expect(knownVariations([make('p1', 'SKU-1')])).toEqual([])
  })
})
