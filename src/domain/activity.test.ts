import { describe, expect, it } from 'vitest'
import type { Product, ReturnCase, Sale } from './types'
import {
  describeMemberInvited,
  describeMemberRemoved,
  describeMemberRoleChanged,
  describeProductCreated,
  describeProductEdit,
  describeProductRemoved,
  describeReturnEdit,
  describeSaleEdit,
  returnEntityLabel,
  saleEntityLabel,
} from './activity'

const product: Product = {
  id: 'p1',
  barcode: '5012345678900',
  sku: 'SKU-1',
  name: 'Widget',
  category: 'Hardware',
  location: 'A1',
  variation: '',
  quantity: 10,
  reorderLevel: 4,
  cost: 3,
  price: 9.99,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('describeProductEdit', () => {
  it('summarises a single changed field', () => {
    const after = { ...product, quantity: 8 }
    expect(describeProductEdit(product, after)).toBe('qty 10 → 8')
  })

  it('summarises multiple changed fields, comma-separated', () => {
    const after = { ...product, quantity: 8, price: 12.99 }
    expect(describeProductEdit(product, after)).toBe('qty 10 → 8, price 9.99 → 12.99')
  })

  it('returns an empty string when nothing tracked actually changed', () => {
    // Only updatedAt differs — not one of the tracked fields.
    const after = { ...product, updatedAt: '2026-01-02T00:00:00.000Z' }
    expect(describeProductEdit(product, after)).toBe('')
  })

  it('ignores id/createdAt/updatedAt even when they differ', () => {
    const after = { ...product, id: 'different', createdAt: 'different', updatedAt: 'different' }
    expect(describeProductEdit(product, after)).toBe('')
  })

  it('covers name, sku, barcode, category, location, variation and reorder level', () => {
    const after: Product = {
      ...product,
      name: 'New name',
      sku: 'SKU-2',
      barcode: '999',
      category: 'New category',
      location: 'B2',
      variation: 'Red',
      reorderLevel: 6,
    }
    const detail = describeProductEdit(product, after)
    expect(detail).toContain('name Widget → New name')
    expect(detail).toContain('SKU SKU-1 → SKU-2')
    expect(detail).toContain('barcode 5012345678900 → 999')
    expect(detail).toContain('category Hardware → New category')
    expect(detail).toContain('location A1 → B2')
    expect(detail).toContain('variation  → Red')
    expect(detail).toContain('reorder level 4 → 6')
  })
})

describe('describeProductCreated', () => {
  it('reports the starting quantity and price', () => {
    expect(describeProductCreated(product)).toBe('qty 10, price 9.99')
  })

  it('omits price when it is zero', () => {
    expect(describeProductCreated({ ...product, price: 0 })).toBe('qty 10')
  })
})

describe('describeProductRemoved', () => {
  it('reports the last known quantity', () => {
    expect(describeProductRemoved(product)).toBe('had qty 10')
  })
})

const saleLine = (overrides: Partial<Sale['lines'][number]> = {}): Sale['lines'][number] => ({
  id: 'sl1',
  saleId: 's1',
  productId: 'p1',
  sku: 'SKU-1',
  name: 'Widget',
  quantity: 1,
  unitPrice: 10,
  unitCost: 3,
  lineTotal: 10,
  lineProfit: 7,
  ...overrides,
})

const sale = (overrides: Partial<Sale> = {}): Sale => ({
  id: 's1',
  channel: 'eBay',
  paymentMethod: 'card',
  subtotal: 10,
  totalCost: 3,
  profit: 7,
  createdAt: '2026-01-01T00:00:00.000Z',
  lines: [saleLine()],
  ...overrides,
})

describe('saleEntityLabel', () => {
  it('identifies a sale by channel and subtotal', () => {
    expect(saleEntityLabel(sale())).toBe('Sale — eBay (£10.00)')
  })

  it('falls back to "Unspecified" for a blank channel', () => {
    expect(saleEntityLabel(sale({ channel: '' }))).toBe('Sale — Unspecified (£10.00)')
  })
})

describe('describeSaleEdit', () => {
  it('summarises a channel change', () => {
    const after = sale({ channel: 'Vinted' })
    expect(describeSaleEdit(sale(), after)).toBe('channel eBay → Vinted')
  })

  it('summarises a quantity change on a line', () => {
    const after = sale({ subtotal: 20, lines: [saleLine({ quantity: 2, lineTotal: 20, lineProfit: 14 })] })
    expect(describeSaleEdit(sale(), after)).toBe('subtotal £10.00 → £20.00, items 1x SKU-1 → 2x SKU-1')
  })

  it('returns an empty string when nothing tracked actually changed', () => {
    expect(describeSaleEdit(sale(), sale())).toBe('')
  })
})

const returnCase = (overrides: Partial<ReturnCase> = {}): ReturnCase => ({
  id: 'r1',
  saleId: '',
  channel: 'eBay',
  customerRef: '',
  reason: '',
  notes: '',
  actions: ['refund'],
  refundAmount: 5,
  refundMethod: 'card',
  goodwillType: '',
  goodwillValue: 0,
  returnLines: [{ id: 'rl1', returnId: 'r1', productId: 'p1', sku: 'SKU-1', name: 'Widget', quantity: 1, disposition: 'restock', unitCost: 3 }],
  replacementLines: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

describe('returnEntityLabel', () => {
  it('identifies a return case by customer reference', () => {
    expect(returnEntityLabel(returnCase({ customerRef: 'Jane D.' }))).toBe('Return case — Jane D.')
  })

  it('falls back to channel, then "Unspecified"', () => {
    expect(returnEntityLabel(returnCase({ customerRef: '' }))).toBe('Return case — eBay')
    expect(returnEntityLabel(returnCase({ customerRef: '', channel: '' }))).toBe('Return case — Unspecified')
  })
})

describe('describeReturnEdit', () => {
  it('summarises a refund amount change', () => {
    const after = returnCase({ refundAmount: 8 })
    expect(describeReturnEdit(returnCase(), after)).toBe('refund £5.00 → £8.00')
  })

  it('summarises an actions change', () => {
    const after = returnCase({ actions: ['refund', 'goodwill'], goodwillValue: 2 })
    const detail = describeReturnEdit(returnCase(), after)
    expect(detail).toContain('actions refund → goodwill+refund')
    expect(detail).toContain('goodwill £0.00 → £2.00')
  })

  it('returns an empty string when nothing tracked actually changed', () => {
    expect(describeReturnEdit(returnCase(), returnCase())).toBe('')
  })
})

describe('member activity descriptions', () => {
  it('describes a brand-new invite', () => {
    expect(describeMemberInvited('employee', false)).toBe('role: employee')
  })

  it('describes linking an existing account in immediately', () => {
    expect(describeMemberInvited('manager', true)).toBe('role: manager (existing account linked)')
  })

  it('describes a removal by the role they held', () => {
    expect(describeMemberRemoved('employee')).toBe('was employee')
  })

  it('describes a role change', () => {
    expect(describeMemberRoleChanged('employee', 'manager')).toBe('role employee → manager')
  })
})
