import { beforeEach, describe, expect, it } from 'vitest'
import { createLocalRepository, STORAGE_KEY } from './localRepository'
import type { ProductDraft } from '../domain/types'

/**
 * An in-memory Storage so the suite does not depend on the host's localStorage
 * implementation (Node 25 ships its own, which shadows jsdom's).
 */
function memoryStorage(): Storage {
  let map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
    key: (index) => [...map.keys()][index] ?? null,
  }
}

let storage: Storage

const draft = (overrides: Partial<ProductDraft> = {}): ProductDraft => ({
  barcode: '5012345678900',
  sku: 'SKU-1',
  name: 'Widget',
  category: 'Hardware',
  location: 'A1',
  variation: '',
  quantity: 10,
  reorderLevel: 4,
  cost: 3,
  price: 8,
  ...overrides,
})

beforeEach(() => {
  storage = memoryStorage()
})

describe('createLocalRepository', () => {
  it('seeds demo data on first run so the app is usable with no credentials', async () => {
    const repo = createLocalRepository({ storage })
    const products = await repo.listProducts()
    expect(products.length).toBeGreaterThan(0)
    expect(products.every((p) => p.barcode && p.sku && p.name)).toBe(true)
  })

  it('persists to localStorage and reloads the same data in a new instance', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    await repo.createProduct(draft({ name: 'Persisted' }))
    expect(storage.getItem(STORAGE_KEY)).toContain('Persisted')

    const reopened = createLocalRepository({ storage, seed: false })
    const products = await reopened.listProducts()
    expect(products.map((p) => p.name)).toEqual(['Persisted'])
  })

  it('does not reseed when storage already holds data', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    await repo.createProduct(draft())
    expect(await createLocalRepository({ storage }).listProducts()).toHaveLength(1)
  })

  it('recovers from corrupt storage instead of throwing', async () => {
    storage.setItem(STORAGE_KEY, 'not json{{')
    const repo = createLocalRepository({ storage, seed: false })
    expect(await repo.listProducts()).toEqual([])
  })
})

describe('createProduct', () => {
  it('assigns an id and timestamps', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const result = await repo.createProduct(draft())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.id).toBeTruthy()
    expect(result.value.createdAt).toBe(result.value.updatedAt)
    expect(result.value.name).toBe('Widget')
  })

  it('rejects an invalid draft', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const result = await repo.createProduct(draft({ name: '' }))
    expect(result.ok === false && result.error).toMatch(/name is required/i)
    expect(await repo.listProducts()).toHaveLength(0)
  })

  it('rejects a duplicate barcode', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    await repo.createProduct(draft())
    const result = await repo.createProduct(draft({ sku: 'SKU-2', name: 'Other' }))
    expect(result.ok === false && result.error).toMatch(/barcode is already used/i)
    expect(await repo.listProducts()).toHaveLength(1)
  })

  it('rejects a duplicate SKU', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    await repo.createProduct(draft())
    const result = await repo.createProduct(draft({ barcode: '', name: 'Other' }))
    expect(result.ok === false && result.error).toMatch(/sku is already used/i)
    expect(await repo.listProducts()).toHaveLength(1)
  })

  it('trims a scanned barcode before storing it', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const result = await repo.createProduct(draft({ barcode: ' 12345 \r\n' }))
    expect(result.ok === true && result.value.barcode).toBe('12345')
  })

  it('allows any number of products with no barcode at all', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    await repo.createProduct(draft({ barcode: '', sku: 'SKU-1' }))
    const second = await repo.createProduct(draft({ barcode: '', sku: 'SKU-2' }))
    expect(second.ok).toBe(true)
    expect(await repo.listProducts()).toHaveLength(2)
  })
})

describe('updateProduct', () => {
  it('edits fields and moves updatedAt forward', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const created = await repo.createProduct(draft())
    if (!created.ok) throw new Error(created.error)

    const updated = await repo.updateProduct(created.value.id, draft({ name: 'Renamed' }))
    expect(updated.ok === true && updated.value.name).toBe('Renamed')
    expect(updated.ok === true && updated.value.createdAt).toBe(created.value.createdAt)
  })

  it('lets a product keep its own barcode', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const created = await repo.createProduct(draft())
    if (!created.ok) throw new Error(created.error)
    const updated = await repo.updateProduct(created.value.id, draft({ quantity: 99 }))
    expect(updated.ok).toBe(true)
  })

  it('rejects taking another product barcode', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    await repo.createProduct(draft({ barcode: 'AAA' }))
    const second = await repo.createProduct(draft({ barcode: 'BBB', sku: 'SKU-2' }))
    if (!second.ok) throw new Error(second.error)

    const result = await repo.updateProduct(second.value.id, draft({ barcode: 'AAA' }))
    expect(result.ok === false && result.error).toMatch(/barcode is already used/i)
  })

  it('rejects taking another product SKU', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    await repo.createProduct(draft({ barcode: 'AAA', sku: 'SKU-1' }))
    const second = await repo.createProduct(draft({ barcode: 'BBB', sku: 'SKU-2' }))
    if (!second.ok) throw new Error(second.error)

    const result = await repo.updateProduct(second.value.id, draft({ barcode: 'BBB', sku: 'SKU-1' }))
    expect(result.ok === false && result.error).toMatch(/sku is already used/i)
  })

  it('reports an unknown product', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const result = await repo.updateProduct('nope', draft())
    expect(result.ok === false && result.error).toMatch(/product not found/i)
  })
})

describe('recordMovement', () => {
  it('applies the movement, persists the new quantity and writes an audit row', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const created = await repo.createProduct(draft({ quantity: 10 }))
    if (!created.ok) throw new Error(created.error)

    const result = await repo.recordMovement(created.value.id, {
      type: 'out',
      quantity: 3,
      reason: 'Sold',
    })
    expect(result.ok === true && result.value.product.quantity).toBe(7)

    const [stored] = await repo.listProducts()
    expect(stored.quantity).toBe(7)

    const movements = await repo.listMovements()
    expect(movements).toHaveLength(1)
    expect(movements[0]).toMatchObject({
      productId: created.value.id,
      type: 'out',
      delta: -3,
      previousQuantity: 10,
      newQuantity: 7,
      reason: 'Sold',
    })
  })

  it('lists movements newest first', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const created = await repo.createProduct(draft({ quantity: 0 }))
    if (!created.ok) throw new Error(created.error)

    await repo.recordMovement(created.value.id, { type: 'in', quantity: 1, reason: 'first' })
    await repo.recordMovement(created.value.id, { type: 'in', quantity: 2, reason: 'second' })

    const movements = await repo.listMovements()
    expect(movements.map((m) => m.reason)).toEqual(['second', 'first'])
  })

  it('refuses to oversell and leaves the stored quantity untouched', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const created = await repo.createProduct(draft({ quantity: 2 }))
    if (!created.ok) throw new Error(created.error)

    const result = await repo.recordMovement(created.value.id, { type: 'out', quantity: 5 })
    expect(result.ok === false && result.error).toMatch(/only 2 in stock/i)
    expect((await repo.listProducts())[0].quantity).toBe(2)
    expect(await repo.listMovements()).toHaveLength(0)
  })

  it('reports an unknown product', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const result = await repo.recordMovement('nope', { type: 'in', quantity: 1 })
    expect(result.ok === false && result.error).toMatch(/product not found/i)
  })
})

describe('deleteProduct', () => {
  it('removes the product but keeps its movement history for audit', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const created = await repo.createProduct(draft())
    if (!created.ok) throw new Error(created.error)
    await repo.recordMovement(created.value.id, { type: 'in', quantity: 1 })

    await repo.deleteProduct(created.value.id)
    expect(await repo.listProducts()).toEqual([])
    expect(await repo.listMovements()).toHaveLength(1)
  })
})

describe('recordSale', () => {
  it('decrements stock for every line, writes movements and returns totals', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const bolt = await repo.createProduct(
      draft({ barcode: '', sku: 'BLT', name: 'Bolt', quantity: 10, cost: 2, price: 5 }),
    )
    const washer = await repo.createProduct(
      draft({ barcode: '', sku: 'WSH', name: 'Washer', quantity: 20, cost: 0.5, price: 1.5 }),
    )
    if (!bolt.ok || !washer.ok) throw new Error('setup failed')

    const result = await repo.recordSale({
      channel: 'eBay',
      paymentMethod: 'card',
      lines: [
        { productId: bolt.value.id, quantity: 3, unitPrice: 5 },
        { productId: washer.value.id, quantity: 4, unitPrice: 1.5 },
      ],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.subtotal).toBeCloseTo(3 * 5 + 4 * 1.5)
    expect(result.value.totalCost).toBeCloseTo(3 * 2 + 4 * 0.5)
    expect(result.value.profit).toBeCloseTo(result.value.subtotal - result.value.totalCost)
    expect(result.value.lines).toHaveLength(2)

    const products = await repo.listProducts()
    expect(products.find((p) => p.id === bolt.value.id)?.quantity).toBe(7)
    expect(products.find((p) => p.id === washer.value.id)?.quantity).toBe(16)

    const movements = await repo.listMovements()
    expect(movements).toHaveLength(2)
    expect(movements.every((m) => m.type === 'out' && m.reason === 'Sale — eBay')).toBe(true)

    const sales = await repo.listSales()
    expect(sales).toHaveLength(1)
    expect(sales[0].channel).toBe('eBay')
  })

  it('nets marketplace fees out of profit, deducting delivery only when the seller paid it', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const bolt = await repo.createProduct(
      draft({ barcode: '', sku: 'BLT', name: 'Bolt', quantity: 10, cost: 2, price: 5 }),
    )
    if (!bolt.ok) throw new Error('setup failed')

    const result = await repo.recordSale({
      channel: 'eBay',
      paymentMethod: 'card',
      lines: [{ productId: bolt.value.id, quantity: 1, unitPrice: 5 }],
      buyerProtectionFee: 1,
      deliveryCost: 2,
      deliveryPaidBy: 'buyer',
      vat: 0.5,
      advertisingCost: 0.25,
      orderTotal: 8.5,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Line profit is 5 - 2 = 3. Delivery is excluded (buyer paid it); the
    // other three fees still come off: 3 - (1 + 0.5 + 0.25) = 1.25.
    expect(result.value.profit).toBeCloseTo(1.25)
    expect(result.value.buyerProtectionFee).toBe(1)
    expect(result.value.deliveryCost).toBe(2)
    expect(result.value.deliveryPaidBy).toBe('buyer')
    expect(result.value.vat).toBe(0.5)
    expect(result.value.advertisingCost).toBe(0.25)
    expect(result.value.orderTotal).toBe(8.5)
  })

  it('deducts delivery from profit when the seller paid it', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const bolt = await repo.createProduct(
      draft({ barcode: '', sku: 'BLT', name: 'Bolt', quantity: 10, cost: 2, price: 5 }),
    )
    if (!bolt.ok) throw new Error('setup failed')

    const result = await repo.recordSale({
      channel: 'eBay',
      paymentMethod: 'card',
      lines: [{ productId: bolt.value.id, quantity: 1, unitPrice: 5 }],
      deliveryCost: 2,
      deliveryPaidBy: 'seller',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Line profit 3, minus the 2 the seller spent on delivery.
    expect(result.value.profit).toBeCloseTo(1)
  })

  it('defaults every fee to 0 (and delivery to seller-paid) when none are given', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const bolt = await repo.createProduct(
      draft({ barcode: '', sku: 'BLT', name: 'Bolt', quantity: 10, cost: 2, price: 5 }),
    )
    if (!bolt.ok) throw new Error('setup failed')

    const result = await repo.recordSale({
      channel: 'eBay',
      paymentMethod: 'card',
      lines: [{ productId: bolt.value.id, quantity: 1, unitPrice: 5 }],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.profit).toBeCloseTo(3)
    expect(result.value.buyerProtectionFee).toBe(0)
    expect(result.value.deliveryCost).toBe(0)
    expect(result.value.deliveryPaidBy).toBe('seller')
    expect(result.value.vat).toBe(0)
    expect(result.value.advertisingCost).toBe(0)
    expect(result.value.orderTotal).toBeNull()
  })

  it('refuses an empty sale', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const result = await repo.recordSale({ channel: 'eBay', paymentMethod: 'cash', lines: [] })
    expect(result.ok === false && result.error).toMatch(/at least one item/i)
  })

  it('refuses to oversell and leaves stock and sales untouched', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const created = await repo.createProduct(draft({ quantity: 2 }))
    if (!created.ok) throw new Error(created.error)

    const result = await repo.recordSale({
      channel: 'eBay',
      paymentMethod: 'cash',
      lines: [{ productId: created.value.id, quantity: 5, unitPrice: 8 }],
    })

    expect(result.ok === false && result.error).toMatch(/only 2 in stock/i)
    expect((await repo.listProducts())[0].quantity).toBe(2)
    expect(await repo.listSales()).toEqual([])
  })

  it('leaves everything untouched when a later line in the same sale fails', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const ok1 = await repo.createProduct(draft({ barcode: '', sku: 'OK1', quantity: 10 }))
    const short = await repo.createProduct(draft({ barcode: '', sku: 'SHORT', quantity: 1 }))
    if (!ok1.ok || !short.ok) throw new Error('setup failed')

    const result = await repo.recordSale({
      channel: 'eBay',
      paymentMethod: 'cash',
      lines: [
        { productId: ok1.value.id, quantity: 2, unitPrice: 8 },
        { productId: short.value.id, quantity: 5, unitPrice: 8 },
      ],
    })

    expect(result.ok).toBe(false)
    const products = await repo.listProducts()
    expect(products.find((p) => p.id === ok1.value.id)?.quantity).toBe(10)
    expect(await repo.listMovements()).toEqual([])
    expect(await repo.listSales()).toEqual([])
  })

  it('reports an unknown product', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const result = await repo.recordSale({
      channel: 'eBay',
      paymentMethod: 'cash',
      lines: [{ productId: 'nope', quantity: 1, unitPrice: 5 }],
    })
    expect(result.ok === false && result.error).toMatch(/product not found/i)
  })
})

describe('updateSale', () => {
  it('reverses the original lines and reapplies the edited ones, netting stock correctly', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const bolt = await repo.createProduct(
      draft({ barcode: '', sku: 'BLT', name: 'Bolt', quantity: 10, cost: 2, price: 5 }),
    )
    if (!bolt.ok) throw new Error('setup failed')

    const sale = await repo.recordSale({
      channel: 'eBay',
      paymentMethod: 'card',
      lines: [{ productId: bolt.value.id, quantity: 3, unitPrice: 5 }],
    })
    if (!sale.ok) throw new Error('setup failed')
    expect((await repo.listProducts()).find((p) => p.id === bolt.value.id)?.quantity).toBe(7)

    const result = await repo.updateSale(sale.value.id, {
      channel: 'Facebook Marketplace',
      paymentMethod: 'cash',
      lines: [{ productId: bolt.value.id, quantity: 5, unitPrice: 6 }],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.channel).toBe('Facebook Marketplace')
    expect(result.value.subtotal).toBeCloseTo(5 * 6)
    expect(result.value.lines).toHaveLength(1)
    expect(result.value.updatedAt).toBeTruthy()

    // Net effect vs. the original 10 on hand: sold 5 net (not 3 + 5 = 8).
    const products = await repo.listProducts()
    expect(products.find((p) => p.id === bolt.value.id)?.quantity).toBe(5)

    const sales = await repo.listSales()
    expect(sales).toHaveLength(1)
    expect(sales[0].lines[0].quantity).toBe(5)

    // Reversal + reapply each write their own audit movement, alongside the
    // original sale's — three in total.
    const movements = await repo.listMovements()
    expect(movements).toHaveLength(3)
    expect(movements.some((m) => m.type === 'in' && m.delta === 3)).toBe(true)
    expect(movements.some((m) => m.type === 'out' && m.delta === -5)).toBe(true)
    expect(movements.some((m) => m.type === 'out' && m.delta === -3)).toBe(true)
  })

  it('recalculates profit against the edited fees, not the fees the sale was first recorded with', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const bolt = await repo.createProduct(
      draft({ barcode: '', sku: 'BLT', name: 'Bolt', quantity: 10, cost: 2, price: 5 }),
    )
    if (!bolt.ok) throw new Error('setup failed')

    const sale = await repo.recordSale({
      channel: 'eBay',
      paymentMethod: 'card',
      lines: [{ productId: bolt.value.id, quantity: 1, unitPrice: 5 }],
      deliveryCost: 2,
      deliveryPaidBy: 'buyer',
    })
    if (!sale.ok) throw new Error('setup failed')
    expect(sale.value.profit).toBeCloseTo(3) // delivery excluded — buyer paid

    const result = await repo.updateSale(sale.value.id, {
      channel: 'eBay',
      paymentMethod: 'card',
      lines: [{ productId: bolt.value.id, quantity: 1, unitPrice: 5 }],
      deliveryCost: 2,
      deliveryPaidBy: 'seller',
      vat: 0.5,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Now the seller is on the hook for delivery too: 3 - (2 + 0.5) = 0.5.
    expect(result.value.profit).toBeCloseTo(0.5)
    expect(result.value.deliveryPaidBy).toBe('seller')
    expect(result.value.vat).toBe(0.5)
  })

  it('drops a line entirely when the edited sale no longer includes that product', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const bolt = await repo.createProduct(draft({ barcode: '', sku: 'BLT', quantity: 10 }))
    const washer = await repo.createProduct(draft({ barcode: '', sku: 'WSH', quantity: 10 }))
    if (!bolt.ok || !washer.ok) throw new Error('setup failed')

    const sale = await repo.recordSale({
      channel: 'eBay',
      paymentMethod: 'card',
      lines: [
        { productId: bolt.value.id, quantity: 2, unitPrice: 8 },
        { productId: washer.value.id, quantity: 3, unitPrice: 8 },
      ],
    })
    if (!sale.ok) throw new Error('setup failed')

    const result = await repo.updateSale(sale.value.id, {
      channel: 'eBay',
      paymentMethod: 'card',
      lines: [{ productId: bolt.value.id, quantity: 2, unitPrice: 8 }],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.lines).toHaveLength(1)

    const products = await repo.listProducts()
    // Bolt: sold 2, unchanged net. Washer: fully returned to stock.
    expect(products.find((p) => p.id === bolt.value.id)?.quantity).toBe(8)
    expect(products.find((p) => p.id === washer.value.id)?.quantity).toBe(10)
  })

  it('refuses to oversell on the edited lines and leaves the sale as it was', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const bolt = await repo.createProduct(draft({ quantity: 5 }))
    if (!bolt.ok) throw new Error('setup failed')

    const sale = await repo.recordSale({
      channel: 'eBay',
      paymentMethod: 'card',
      lines: [{ productId: bolt.value.id, quantity: 2, unitPrice: 8 }],
    })
    if (!sale.ok) throw new Error('setup failed')

    const result = await repo.updateSale(sale.value.id, {
      channel: 'eBay',
      paymentMethod: 'card',
      lines: [{ productId: bolt.value.id, quantity: 99, unitPrice: 8 }],
    })

    expect(result.ok === false && result.error).toMatch(/only \d+ in stock/i)
    const sales = await repo.listSales()
    expect(sales[0].lines[0].quantity).toBe(2)
  })

  it('reports an unknown sale', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const result = await repo.updateSale('nope', { channel: 'eBay', paymentMethod: 'cash', lines: [] })
    expect(result.ok === false && result.error).toMatch(/sale not found/i)
  })
})

describe('recordReturn', () => {
  it('restocks a returned item, writes an audit movement and records the case', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const bolt = await repo.createProduct(draft({ barcode: '', sku: 'BLT', name: 'Bolt', quantity: 10, cost: 2 }))
    if (!bolt.ok) throw new Error('setup failed')

    const result = await repo.recordReturn({
      channel: 'eBay',
      reason: 'Wrong size',
      actions: ['refund', 'return'],
      refundAmount: 5,
      refundMethod: 'card',
      returnLines: [{ productId: bolt.value.id, quantity: 3, disposition: 'restock' }],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.refundAmount).toBe(5)
    expect(result.value.returnLines).toHaveLength(1)
    expect(result.value.returnLines[0]).toMatchObject({ quantity: 3, disposition: 'restock', unitCost: 2 })

    const products = await repo.listProducts()
    expect(products.find((p) => p.id === bolt.value.id)?.quantity).toBe(13)

    const movements = await repo.listMovements()
    expect(movements).toHaveLength(1)
    expect(movements[0]).toMatchObject({ type: 'in', delta: 3, reason: 'Return — restock: Wrong size' })

    const returns = await repo.listReturns()
    expect(returns).toHaveLength(1)
    expect(returns[0].id).toBe(result.value.id)
  })

  it('writes off a returned item with no stock movement, capturing the loss on the line', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const bolt = await repo.createProduct(draft({ barcode: '', sku: 'BLT', name: 'Bolt', quantity: 10, cost: 2 }))
    if (!bolt.ok) throw new Error('setup failed')

    const result = await repo.recordReturn({
      actions: ['return'],
      returnLines: [{ productId: bolt.value.id, quantity: 2, disposition: 'writeoff' }],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.returnLines[0]).toMatchObject({ disposition: 'writeoff', unitCost: 2 })

    const products = await repo.listProducts()
    expect(products.find((p) => p.id === bolt.value.id)?.quantity).toBe(10)
    expect(await repo.listMovements()).toHaveLength(0)
  })

  it('decrements stock for a replacement line at no charge', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const bolt = await repo.createProduct(draft({ barcode: '', sku: 'BLT', name: 'Bolt', quantity: 10, cost: 2 }))
    if (!bolt.ok) throw new Error('setup failed')

    const result = await repo.recordReturn({
      actions: ['replacement'],
      replacementLines: [{ productId: bolt.value.id, quantity: 2 }],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.replacementLines[0]).toMatchObject({ quantity: 2, unitCost: 2 })

    const products = await repo.listProducts()
    expect(products.find((p) => p.id === bolt.value.id)?.quantity).toBe(8)

    const movements = await repo.listMovements()
    expect(movements).toHaveLength(1)
    expect(movements[0]).toMatchObject({ type: 'out', delta: -2 })
  })

  it('accepts a goodwill-only case with no item involved', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const result = await repo.recordReturn({
      actions: ['goodwill'],
      goodwillType: 'Voucher',
      goodwillValue: 10,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.goodwillType).toBe('Voucher')
    expect(result.value.goodwillValue).toBe(10)
  })

  it('refuses a case with nothing recorded at all', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const result = await repo.recordReturn({ actions: [] })
    expect(result.ok === false && result.error).toMatch(/at least one action/i)
    expect(await repo.listReturns()).toEqual([])
  })

  it('refuses to oversell a replacement and leaves stock untouched', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const bolt = await repo.createProduct(draft({ quantity: 1 }))
    if (!bolt.ok) throw new Error('setup failed')

    const result = await repo.recordReturn({
      actions: ['replacement'],
      replacementLines: [{ productId: bolt.value.id, quantity: 5 }],
    })

    expect(result.ok === false && result.error).toMatch(/only 1 in stock/i)
    expect((await repo.listProducts())[0].quantity).toBe(1)
    expect(await repo.listReturns()).toEqual([])
  })

  it('reports an unknown product', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const result = await repo.recordReturn({
      actions: ['return'],
      returnLines: [{ productId: 'nope', quantity: 1, disposition: 'restock' }],
    })
    expect(result.ok === false && result.error).toMatch(/product not found/i)
  })

  it('lists returns newest first', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    await repo.recordReturn({ actions: ['goodwill'], goodwillType: 'first', goodwillValue: 1 })
    await repo.recordReturn({ actions: ['goodwill'], goodwillType: 'second', goodwillValue: 1 })

    const returns = await repo.listReturns()
    expect(returns.map((r) => r.goodwillType)).toEqual(['second', 'first'])
  })
})

describe('updateReturn', () => {
  it('reverses a restock and reapplies the edited quantity, netting stock correctly', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const bolt = await repo.createProduct(draft({ barcode: '', sku: 'BLT', quantity: 10, cost: 2 }))
    if (!bolt.ok) throw new Error('setup failed')

    const original = await repo.recordReturn({
      channel: 'eBay',
      reason: 'Wrong size',
      actions: ['return'],
      returnLines: [{ productId: bolt.value.id, quantity: 3, disposition: 'restock' }],
    })
    if (!original.ok) throw new Error('setup failed')
    expect((await repo.listProducts()).find((p) => p.id === bolt.value.id)?.quantity).toBe(13)

    const result = await repo.updateReturn(original.value.id, {
      channel: 'eBay',
      reason: 'Wrong size, corrected qty',
      actions: ['return'],
      returnLines: [{ productId: bolt.value.id, quantity: 5, disposition: 'restock' }],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.returnLines[0].quantity).toBe(5)
    expect(result.value.updatedAt).toBeTruthy()

    // Net effect vs. the original 10 on hand: 5 restocked (not 3 + 5 = 8).
    const products = await repo.listProducts()
    expect(products.find((p) => p.id === bolt.value.id)?.quantity).toBe(15)
  })

  it('refuses to edit away a restock once the stock has since been sold', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const bolt = await repo.createProduct(draft({ barcode: '', sku: 'BLT', quantity: 10 }))
    if (!bolt.ok) throw new Error('setup failed')

    const original = await repo.recordReturn({
      actions: ['return'],
      returnLines: [{ productId: bolt.value.id, quantity: 3, disposition: 'restock' }],
    })
    if (!original.ok) throw new Error('setup failed')
    // Now 13 on hand — sell 12 of it, leaving only 1, less than the 3 this
    // case restocked.
    await repo.recordSale({
      channel: 'eBay',
      paymentMethod: 'cash',
      lines: [{ productId: bolt.value.id, quantity: 12, unitPrice: 8 }],
    })

    const result = await repo.updateReturn(original.value.id, {
      actions: ['return'],
      returnLines: [{ productId: bolt.value.id, quantity: 1, disposition: 'restock' }],
    })

    expect(result.ok === false && result.error).toMatch(/already been sold/i)
    // Left exactly as the sale left it.
    expect((await repo.listProducts()).find((p) => p.id === bolt.value.id)?.quantity).toBe(1)
  })

  it('switches a line from restock to writeoff, taking the stock back out', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const bolt = await repo.createProduct(draft({ barcode: '', sku: 'BLT', quantity: 10, cost: 2 }))
    if (!bolt.ok) throw new Error('setup failed')

    const original = await repo.recordReturn({
      actions: ['return'],
      returnLines: [{ productId: bolt.value.id, quantity: 3, disposition: 'restock' }],
    })
    if (!original.ok) throw new Error('setup failed')

    const result = await repo.updateReturn(original.value.id, {
      actions: ['return'],
      returnLines: [{ productId: bolt.value.id, quantity: 3, disposition: 'writeoff' }],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.returnLines[0].disposition).toBe('writeoff')
    // Back to the original 10 — the restock is undone, and a writeoff never
    // adds stock back.
    expect((await repo.listProducts()).find((p) => p.id === bolt.value.id)?.quantity).toBe(10)
  })

  it('reverses a replacement line, giving the stock back', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const bolt = await repo.createProduct(draft({ barcode: '', sku: 'BLT', quantity: 10, cost: 2 }))
    if (!bolt.ok) throw new Error('setup failed')

    const original = await repo.recordReturn({
      actions: ['replacement'],
      replacementLines: [{ productId: bolt.value.id, quantity: 2 }],
    })
    if (!original.ok) throw new Error('setup failed')
    expect((await repo.listProducts()).find((p) => p.id === bolt.value.id)?.quantity).toBe(8)

    const result = await repo.updateReturn(original.value.id, {
      actions: [],
      notes: 'Customer changed their mind before the replacement shipped',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.replacementLines).toHaveLength(0)
    expect((await repo.listProducts()).find((p) => p.id === bolt.value.id)?.quantity).toBe(10)
  })

  it('reports an unknown return', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const result = await repo.updateReturn('nope', { actions: ['goodwill'], goodwillType: 'x', goodwillValue: 1 })
    expect(result.ok === false && result.error).toMatch(/return not found/i)
  })

  describe('profile', () => {
    it('starts with an empty profile', async () => {
      const repo = createLocalRepository({ storage, seed: false })
      const profile = await repo.getProfile()
      expect(profile).toMatchObject({ fullName: '', birthday: '', address: '', employeeNumber: '', username: '' })
    })

    it('applies a profile edit immediately — local mode is always the manager, nobody to approve it', async () => {
      const repo = createLocalRepository({ storage, seed: false })
      const result = await repo.updateProfile({
        fullName: 'Jane Doe',
        birthday: '1990-01-01',
        address: '1 High Street',
        employeeNumber: 'EMP-1',
        username: 'jane',
      })

      expect(result.ok).toBe(true)
      expect(result.ok && result.value.status).toBe('applied')
      expect(await repo.getProfile()).toMatchObject({ fullName: 'Jane Doe', username: 'jane' })
    })

    it('persists the profile across a reload, same as products', async () => {
      const repo = createLocalRepository({ storage, seed: false })
      await repo.updateProfile({ fullName: 'Jane Doe', birthday: '', address: '', employeeNumber: '', username: '' })

      const reopened = createLocalRepository({ storage, seed: false })
      expect(await reopened.getProfile()).toMatchObject({ fullName: 'Jane Doe' })
    })

    it('never has anything pending to approve locally', async () => {
      const repo = createLocalRepository({ storage, seed: false })
      expect(await repo.listPendingProfileChanges()).toEqual([])
    })
  })
})
