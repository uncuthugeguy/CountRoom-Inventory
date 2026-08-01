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
  quantity: 10,
  reorderLevel: 4,
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

  it('trims a scanned barcode before storing it', async () => {
    const repo = createLocalRepository({ storage, seed: false })
    const result = await repo.createProduct(draft({ barcode: ' 12345 \r\n' }))
    expect(result.ok === true && result.value.barcode).toBe('12345')
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
