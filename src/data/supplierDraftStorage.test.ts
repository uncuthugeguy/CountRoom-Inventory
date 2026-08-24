import { describe, it, expect, beforeEach } from 'vitest'
import {
  clearSupplierDraft,
  loadSupplierDraftFor,
  saveSupplierDraft,
  SUPPLIER_DRAFT_STORAGE_KEY,
} from './supplierDraftStorage'
import type { SupplierDraft } from '../domain/suppliers'
import { memoryStorage } from '../test/memoryStorage'

const draft: SupplierDraft = {
  name: 'Acme Fasteners Ltd',
  email: 'sales@acme.test',
  phone: '01234 567890',
  address: '1 Industrial Estate',
  leadTimeDays: 5,
  contactName: 'Jo Smith',
  notes: 'Net 30 terms',
}

describe('supplierDraftStorage', () => {
  let storage: Storage

  beforeEach(() => {
    storage = memoryStorage()
  })

  it('returns null when nothing has been saved yet', () => {
    expect(loadSupplierDraftFor({ kind: 'new' }, storage)).toBeNull()
  })

  it('round-trips a draft for the "new supplier" context', () => {
    saveSupplierDraft({ kind: 'new' }, draft, storage)
    expect(loadSupplierDraftFor({ kind: 'new' }, storage)).toEqual(draft)
  })

  it('round-trips a draft for a specific supplier being edited', () => {
    saveSupplierDraft({ kind: 'edit', supplierId: 'sup-1' }, draft, storage)
    expect(loadSupplierDraftFor({ kind: 'edit', supplierId: 'sup-1' }, storage)).toEqual(draft)
  })

  it("doesn't return a draft saved for a different supplier", () => {
    saveSupplierDraft({ kind: 'edit', supplierId: 'sup-1' }, draft, storage)
    expect(loadSupplierDraftFor({ kind: 'edit', supplierId: 'sup-2' }, storage)).toBeNull()
    expect(loadSupplierDraftFor({ kind: 'new' }, storage)).toBeNull()
  })

  it('clear removes the saved draft', () => {
    saveSupplierDraft({ kind: 'new' }, draft, storage)
    clearSupplierDraft(storage)
    expect(storage.getItem(SUPPLIER_DRAFT_STORAGE_KEY)).toBeNull()
    expect(loadSupplierDraftFor({ kind: 'new' }, storage)).toBeNull()
  })

  it('ignores corrupt JSON rather than throwing', () => {
    storage.setItem(SUPPLIER_DRAFT_STORAGE_KEY, '{not valid json')
    expect(loadSupplierDraftFor({ kind: 'new' }, storage)).toBeNull()
  })
})
