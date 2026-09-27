import { describe, it, expect, beforeEach } from 'vitest'
import {
  clearPurchaseOrderDraft,
  loadPurchaseOrderDraft,
  savePurchaseOrderDraft,
  PURCHASE_ORDER_DRAFT_STORAGE_KEY,
  type PurchaseOrderDraft,
} from './purchaseOrderDraftStorage'
import { memoryStorage } from '../test/memoryStorage'

const draft: PurchaseOrderDraft = {
  supplierId: 'sup-1',
  poNumber: 'PO-0001',
  orderDate: '2026-08-30',
  expectedDeliveryDate: '2026-09-01',
  notes: 'Ring before delivery',
  lines: [{ kind: 'product', productId: 'prod-1', customName: '', isLot: false, quantity: '20', hammerPrice: '0.20', vatAmount: '' }],
  deliveryCost: '0',
  buyersPremium: '0',
  vatAmount: '0',
}

describe('purchaseOrderDraftStorage', () => {
  let storage: Storage

  beforeEach(() => {
    storage = memoryStorage()
  })

  it('returns null when nothing has been saved yet', () => {
    expect(loadPurchaseOrderDraft(storage)).toBeNull()
  })

  it('round-trips a saved draft', () => {
    savePurchaseOrderDraft(draft, storage)
    expect(loadPurchaseOrderDraft(storage)).toEqual(draft)
  })

  it('clear removes the saved draft', () => {
    savePurchaseOrderDraft(draft, storage)
    clearPurchaseOrderDraft(storage)
    expect(storage.getItem(PURCHASE_ORDER_DRAFT_STORAGE_KEY)).toBeNull()
    expect(loadPurchaseOrderDraft(storage)).toBeNull()
  })

  it('converts an older draft that stored a per-unit cost into a line hammer price', () => {
    storage.setItem(
      PURCHASE_ORDER_DRAFT_STORAGE_KEY,
      JSON.stringify({
        savedAt: '2026-09-01T00:00:00Z',
        draft: { ...draft, lines: [{ kind: 'product', productId: 'p', customName: '', isLot: false, quantity: '6', unitCost: '2.50', vatAmount: '' }] },
      }),
    )
    expect(loadPurchaseOrderDraft(storage)?.lines[0]).toEqual({
      kind: 'product', productId: 'p', customName: '', isLot: false, quantity: '6', hammerPrice: '15', vatAmount: '',
    })
  })

  it('ignores corrupt JSON rather than throwing', () => {
    storage.setItem(PURCHASE_ORDER_DRAFT_STORAGE_KEY, '{not valid json')
    expect(loadPurchaseOrderDraft(storage)).toBeNull()
  })
})
