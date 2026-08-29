import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createLocalRepository } from '../data/localRepository'
import type { InventoryRepository } from '../data/repository'
import { memoryStorage } from '../test/memoryStorage'
import { useInventory } from './useInventory'

const draft = {
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
}

const openLocal = () => {
  const repo = createLocalRepository({ storage: memoryStorage(), seed: false })
  return { repo, open: async () => repo }
}

describe('useInventory', () => {
  it('loads the catalogue and reports which backend is live', async () => {
    const { open } = openLocal()
    const { result } = renderHook(() => useInventory(open))

    expect(result.current.status).toBe('loading')
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.backend).toBe('local')
    expect(result.current.products).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it('reports a backend that fails to open rather than hanging on a spinner', async () => {
    const open = () => Promise.reject(new Error('Supabase unreachable'))
    const { result } = renderHook(() => useInventory(open))

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toBe('Supabase unreachable')
  })

  it('adds a product and refreshes the catalogue without a manual reload', async () => {
    const { open } = openLocal()
    const { result } = renderHook(() => useInventory(open))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => {
      const created = await result.current.createProduct(draft)
      expect(created.ok).toBe(true)
    })

    expect(result.current.products.map((p) => p.name)).toEqual(['Widget'])
  })

  it('passes a rejected draft straight back and leaves the catalogue alone', async () => {
    const { open } = openLocal()
    const { result } = renderHook(() => useInventory(open))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => {
      const created = await result.current.createProduct({ ...draft, name: '' })
      expect(created.ok === false && created.error).toMatch(/name is required/i)
    })

    expect(result.current.products).toEqual([])
  })

  it('records a movement and refreshes both the product and the history', async () => {
    const { open } = openLocal()
    const { result } = renderHook(() => useInventory(open))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    let id = ''
    await act(async () => {
      const created = await result.current.createProduct(draft)
      if (created.ok) id = created.value.id
    })

    await act(async () => {
      await result.current.recordMovement(id, { type: 'out', quantity: 3, reason: 'Sold' })
    })

    expect(result.current.products[0].quantity).toBe(7)
    expect(result.current.movements).toHaveLength(1)
    expect(result.current.movements[0]).toMatchObject({ type: 'out', delta: -3 })
  })

  it('removes a deleted product but keeps its history', async () => {
    const { open } = openLocal()
    const { result } = renderHook(() => useInventory(open))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    let id = ''
    await act(async () => {
      const created = await result.current.createProduct(draft)
      if (created.ok) id = created.value.id
    })
    await act(async () => {
      await result.current.recordMovement(id, { type: 'in', quantity: 1 })
    })
    await act(async () => {
      await result.current.deleteProduct(id)
    })

    expect(result.current.products).toEqual([])
    expect(result.current.movements).toHaveLength(1)
  })

  it('turns a thrown backend error into a failed result instead of crashing the screen', async () => {
    const repo: InventoryRepository = {
      kind: 'supabase',
      role: 'manager',
      listProducts: async () => [],
      listMovements: async () => [],
      createProduct: vi.fn(() => Promise.reject(new Error('network down'))),
      updateProduct: vi.fn(),
      deleteProduct: vi.fn(),
      recordMovement: vi.fn(),
      listSales: async () => [],
      recordSale: vi.fn(),
      updateSale: vi.fn(),
      listReturns: async () => [],
      recordReturn: vi.fn(),
      updateReturn: vi.fn(),
      listTeam: async () => [],
      inviteEmployee: vi.fn(),
      removeTeamMember: vi.fn(),
      getProfile: async () => ({ fullName: '', birthday: '', address: '', employeeNumber: '', username: '', updatedAt: 't' }),
      updateProfile: vi.fn(),
      listPendingProfileChanges: async () => [],
      approveProfileChange: vi.fn(),
      rejectProfileChange: vi.fn(),
      getLoginEmail: async () => '',
      updateLoginEmail: vi.fn(),
      getAccountSettings: async () => null,
      setAccountSettings: vi.fn(),
      listSuppliers: async () => [],
      createSupplier: vi.fn(),
      updateSupplier: vi.fn(),
      deleteSupplier: vi.fn(),
      linkSupplierProduct: vi.fn(),
      updateSupplierProduct: vi.fn(),
      unlinkSupplierProduct: vi.fn(),
      listSupplierProducts: async () => [],
      listPurchaseOrders: async () => [],
      createPurchaseOrder: vi.fn(),
      sendPurchaseOrder: vi.fn(),
      confirmPurchaseOrder: vi.fn(),
      receivePurchaseOrder: vi.fn(),
      cancelPurchaseOrder: vi.fn(),
      listActivity: async () => [],
      logActivity: vi.fn(),
    }
    const { result } = renderHook(() => useInventory(async () => repo))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.backend).toBe('supabase')

    await act(async () => {
      const created = await result.current.createProduct(draft)
      expect(created.ok === false && created.error).toBe('network down')
    })

    expect(result.current.status).toBe('ready')
  })

  it('loads returns alongside the rest of the catalogue', async () => {
    const { open } = openLocal()
    const { result } = renderHook(() => useInventory(open))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.returns).toEqual([])
  })

  it('records a return and refreshes the products and returns lists', async () => {
    const { open } = openLocal()
    const { result } = renderHook(() => useInventory(open))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    let id = ''
    await act(async () => {
      const created = await result.current.createProduct(draft)
      if (created.ok) id = created.value.id
    })

    await act(async () => {
      const recorded = await result.current.recordReturn({
        actions: ['return'],
        returnLines: [{ productId: id, quantity: 2, disposition: 'restock' }],
      })
      expect(recorded.ok).toBe(true)
    })

    expect(result.current.products[0].quantity).toBe(12)
    expect(result.current.returns).toHaveLength(1)
  })
})
