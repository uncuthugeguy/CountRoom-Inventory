import { describe, it, expect } from 'vitest'
import {
  getAvailableBatches,
  getExpiryAlerts,
  calculateBatchCostBasis,
  calculateExpiryLoss,
  withdrawFromBatch,
} from './batches'
import type { StockBatch } from './batches'

describe('Batch Tracking', () => {
  const createBatch = (
    id: string,
    quantity: number,
    receivedDate: string,
    expiryDate?: string,
    disposition: 'fifo' | 'lifo' | 'fefo' = 'fifo',
  ): StockBatch => ({
    id,
    productId: 'p1',
    batchNumber: `BATCH-${id}`,
    receivedDate,
    expiryDate,
    quantity,
    unitCost: 10,
    disposition,
    notes: '',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  })

  describe('getAvailableBatches', () => {
    it('returns only non-empty batches', () => {
      const batches = [
        createBatch('b1', 10, '2026-01-01'),
        createBatch('b2', 0, '2026-01-02'), // Empty
        createBatch('b3', 5, '2026-01-03'),
      ]

      const available = getAvailableBatches(batches, 'p1')
      expect(available).toHaveLength(2)
      expect(available.map((b) => b.id)).toEqual(['b1', 'b3'])
    })

    it('orders by FIFO (earliest received first)', () => {
      const batches = [
        createBatch('b1', 10, '2026-01-03', undefined, 'fifo'),
        createBatch('b2', 10, '2026-01-01', undefined, 'fifo'),
        createBatch('b3', 10, '2026-01-02', undefined, 'fifo'),
      ]

      const ordered = getAvailableBatches(batches, 'p1')
      expect(ordered.map((b) => b.id)).toEqual(['b2', 'b3', 'b1'])
    })

    it('orders by LIFO (latest received first)', () => {
      const batches = [
        createBatch('b1', 10, '2026-01-01', undefined, 'lifo'),
        createBatch('b2', 10, '2026-01-03', undefined, 'lifo'),
        createBatch('b3', 10, '2026-01-02', undefined, 'lifo'),
      ]

      const ordered = getAvailableBatches(batches, 'p1')
      expect(ordered.map((b) => b.id)).toEqual(['b2', 'b3', 'b1'])
    })

    it('orders by FEFO (soonest expiry first)', () => {
      const batches = [
        createBatch('b1', 10, '2026-01-01', '2026-03-01', 'fefo'),
        createBatch('b2', 10, '2026-01-02', '2026-02-01', 'fefo'), // Expires first
        createBatch('b3', 10, '2026-01-03', '2026-04-01', 'fefo'),
      ]

      const ordered = getAvailableBatches(batches, 'p1')
      expect(ordered.map((b) => b.id)).toEqual(['b2', 'b1', 'b3'])
    })

    it('filters by product ID', () => {
      const batches = [
        { ...createBatch('b1', 10, '2026-01-01'), productId: 'p1' },
        { ...createBatch('b2', 10, '2026-01-02'), productId: 'p2' },
      ]

      const p1Batches = getAvailableBatches(batches, 'p1')
      expect(p1Batches).toHaveLength(1)
      expect(p1Batches[0].id).toBe('b1')
    })
  })

  describe('getExpiryAlerts', () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    const tomorrowDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
    const tomorrowStr = `${tomorrowDate.getFullYear()}-${String(tomorrowDate.getMonth() + 1).padStart(2, '0')}-${String(tomorrowDate.getDate()).padStart(2, '0')}`
    
    const yesterdayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
    const yesterdayStr = `${yesterdayDate.getFullYear()}-${String(yesterdayDate.getMonth() + 1).padStart(2, '0')}-${String(yesterdayDate.getDate()).padStart(2, '0')}`
    
    const nextMonthDate = new Date(today.getFullYear(), today.getMonth() + 1, today.getDate())
    const nextMonthStr = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}-${String(nextMonthDate.getDate()).padStart(2, '0')}`

    const productNames = new Map([['p1', 'Widget']])

    it('alerts on expired batches', () => {
      const batches = [
        createBatch('b1', 10, '2026-01-01', yesterdayStr),
      ]

      const alerts = getExpiryAlerts(batches, productNames)
      expect(alerts).toHaveLength(1)
      expect(alerts[0].alertType).toBe('expired')
      expect(alerts[0].daysUntilExpiry).toBeLessThan(0)
    })

    it('alerts on expiring-soon batches', () => {
      const batches = [
        createBatch('b1', 10, '2026-01-01', tomorrowStr),
      ]

      const alerts = getExpiryAlerts(batches, productNames, 7)
      expect(alerts).toHaveLength(1)
      expect(alerts[0].alertType).toBe('expiring-soon')
      expect(alerts[0].daysUntilExpiry).toBe(1)
    })

    it('does not alert on batches expiring beyond warning window', () => {
      const batches = [
        createBatch('b1', 10, '2026-01-01', nextMonthStr),
      ]

      const alerts = getExpiryAlerts(batches, productNames, 7)
      expect(alerts).toHaveLength(0)
    })

    it('alerts on FEFO items with no expiry date', () => {
      const batches = [
        createBatch('b1', 10, '2026-01-01', undefined, 'fefo'),
      ]

      const alerts = getExpiryAlerts(batches, productNames)
      expect(alerts).toHaveLength(1)
      expect(alerts[0].alertType).toBe('no-expiry-date')
    })

    it('does not alert on non-FEFO items without expiry', () => {
      const batches = [
        createBatch('b1', 10, '2026-01-01', undefined, 'fifo'),
      ]

      const alerts = getExpiryAlerts(batches, productNames)
      expect(alerts).toHaveLength(0)
    })

    it('ignores empty batches', () => {
      const batches = [
        createBatch('b1', 0, '2026-01-01', yesterdayStr),
      ]

      const alerts = getExpiryAlerts(batches, productNames)
      expect(alerts).toHaveLength(0)
    })
  })

  describe('calculateBatchCostBasis', () => {
    it('sums cost across all batches', () => {
      const batches = [
        createBatch('b1', 10, '2026-01-01'), // 10 * 10 = 100
        createBatch('b2', 5, '2026-01-02'), // 5 * 10 = 50
      ]
      batches[1].unitCost = 10

      const total = calculateBatchCostBasis(batches)
      expect(total).toBe(150)
    })

    it('returns 0 for empty batch list', () => {
      expect(calculateBatchCostBasis([])).toBe(0)
    })
  })

  describe('calculateExpiryLoss', () => {
    it('calculates quantity and cost of expired stock', () => {
      const batches = [
        { ...createBatch('b1', 10, '2026-01-01'), unitCost: 20 }, // 10 * 20 = 200
        { ...createBatch('b2', 5, '2026-01-02'), unitCost: 10 }, // 5 * 10 = 50
      ]

      const loss = calculateExpiryLoss(batches)
      expect(loss.quantity).toBe(15)
      expect(loss.costValue).toBe(250)
    })

    it('ignores empty batches', () => {
      const batches = [
        createBatch('b1', 0, '2026-01-01'),
        createBatch('b2', 5, '2026-01-02'),
      ]

      const loss = calculateExpiryLoss(batches)
      expect(loss.quantity).toBe(5)
      expect(loss.costValue).toBe(50)
    })
  })

  describe('withdrawFromBatch', () => {
    it('reduces batch quantity correctly', () => {
      const batch = createBatch('b1', 10, '2026-01-01')

      const result = withdrawFromBatch(batch, 3)
      expect(result).not.toHaveProperty('error')
      expect((result as any).updated.quantity).toBe(7)
    })

    it('returns error if withdrawing more than available', () => {
      const batch = createBatch('b1', 10, '2026-01-01')

      const result = withdrawFromBatch(batch, 15)
      expect(result).toHaveProperty('error')
    })

    it('generates withdrawal record', () => {
      const batch = createBatch('b1', 10, '2026-01-01')

      const result = withdrawFromBatch(batch, 5)
      expect((result as any).withdrawal).toBeDefined()
      expect((result as any).withdrawal.quantity).toBe(5)
      expect((result as any).withdrawal.batchId).toBe('b1')
    })

    it('handles complete batch withdrawal', () => {
      const batch = createBatch('b1', 10, '2026-01-01')

      const result = withdrawFromBatch(batch, 10)
      expect((result as any).updated.quantity).toBe(0)
    })
  })
})
