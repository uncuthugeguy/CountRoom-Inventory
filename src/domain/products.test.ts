import { describe, expect, it } from 'vitest'
import { emptyDraft, normaliseDraft, validateDraft } from './products'

describe('validateDraft', () => {
  const valid = {
    barcode: '5012345678900',
    sku: 'SKU-1',
    name: 'Widget',
    category: 'Hardware',
    location: 'A1',
    quantity: 10,
    reorderLevel: 4,
  }

  it('accepts a complete draft', () => {
    expect(validateDraft(valid).ok).toBe(true)
  })

  it('requires a barcode', () => {
    const result = validateDraft({ ...valid, barcode: '  ' })
    expect(result.ok === false && result.error).toMatch(/barcode is required/i)
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

  it('allows blank category and location', () => {
    expect(validateDraft({ ...valid, category: '', location: '' }).ok).toBe(true)
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
      quantity: 3,
      reorderLevel: 1,
    })
    expect(draft).toEqual({
      barcode: '5012345678900',
      sku: 'sku-1',
      name: 'Widget',
      category: 'Hardware',
      location: 'A1',
      quantity: 3,
      reorderLevel: 1,
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
      quantity: 0,
      reorderLevel: 0,
    })
  })

  it('pre-fills a scanned barcode', () => {
    expect(emptyDraft('123').barcode).toBe('123')
  })
})
