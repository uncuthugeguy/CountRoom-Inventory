import { describe, expect, it } from 'vitest'
import { buildStocktakeLines, parseBarcodeDump } from './stocktake'
import type { Product } from './types'

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

describe('parseBarcodeDump', () => {
  it('tallies one count per newline-separated code', () => {
    const counts = parseBarcodeDump('5012345678917\n5012345678917\n4006381333931')
    expect(counts).toEqual(new Map([['5012345678917', 2], ['4006381333931', 1]]))
  })

  it('handles commas, tabs and windows line endings, and trims whitespace', () => {
    const counts = parseBarcodeDump('  A123  ,B456\tA123\r\nB456\r\nB456  ')
    expect(counts).toEqual(new Map([['A123', 2], ['B456', 3]]))
  })

  it('ignores blank lines', () => {
    const counts = parseBarcodeDump('A123\n\n\n   \nA123')
    expect(counts).toEqual(new Map([['A123', 2]]))
  })

  it('returns an empty map for blank input', () => {
    expect(parseBarcodeDump('   \n  ')).toEqual(new Map())
  })
})

describe('buildStocktakeLines', () => {
  const washer = product({ id: 'p1', barcode: '5012345678917', name: 'M6 Flat Washer', quantity: 64 })
  const drill = product({ id: 'p2', barcode: '4006381333931', name: 'Cordless Drill 18V', quantity: 7 })

  it('matches counted barcodes to products and computes the difference', () => {
    const counts = new Map([
      ['5012345678917', 60],
      ['4006381333931', 9],
    ])
    const { lines, unmatched } = buildStocktakeLines(counts, [washer, drill])

    expect(unmatched).toEqual([])
    expect(lines).toHaveLength(2)
    expect(lines).toContainEqual({
      barcode: '5012345678917',
      product: washer,
      counted: 60,
      systemQuantity: 64,
      difference: -4,
    })
    expect(lines).toContainEqual({
      barcode: '4006381333931',
      product: drill,
      counted: 9,
      systemQuantity: 7,
      difference: 2,
    })
  })

  it('sorts by the biggest discrepancy first', () => {
    const counts = new Map([
      ['5012345678917', 63], // off by 1
      ['4006381333931', 1], // off by 6
    ])
    const { lines } = buildStocktakeLines(counts, [washer, drill])
    expect(lines.map((l) => l.product.name)).toEqual(['Cordless Drill 18V', 'M6 Flat Washer'])
  })

  it('puts codes with no matching product barcode into unmatched, sorted', () => {
    const counts = new Map([
      ['0000000000002', 1],
      ['0000000000001', 3],
    ])
    const { lines, unmatched } = buildStocktakeLines(counts, [washer])
    expect(lines).toEqual([])
    expect(unmatched).toEqual([
      { barcode: '0000000000001', counted: 3 },
      { barcode: '0000000000002', counted: 1 },
    ])
  })

  it('ignores products with a blank barcode when matching', () => {
    const noBarcode = product({ id: 'p3', barcode: '', name: 'No Barcode Item', quantity: 5 })
    const counts = new Map([['', 2]])
    const { lines, unmatched } = buildStocktakeLines(counts, [noBarcode])
    expect(lines).toEqual([])
    expect(unmatched).toEqual([{ barcode: '', counted: 2 }])
  })

  it('returns nothing for an empty count', () => {
    expect(buildStocktakeLines(new Map(), [washer])).toEqual({ lines: [], unmatched: [] })
  })
})
