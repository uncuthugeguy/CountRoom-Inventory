import type { SupplierDraft } from '../domain/suppliers'

export const SUPPLIER_DRAFT_STORAGE_KEY = 'stockflow.supplierDraft.v1'

/**
 * Identifies which supplier a saved draft belongs to — a specific existing
 * supplier being edited, or a brand new one. Only one supplier dialog can
 * ever be open at a time, so there's only ever one draft worth keeping.
 */
export type SupplierDraftContext = { kind: 'new' } | { kind: 'edit'; supplierId: string }

interface SavedSupplierDraft {
  context: SupplierDraftContext
  draft: SupplierDraft
  savedAt: string
}

const contextKey = (context: SupplierDraftContext): string =>
  context.kind === 'edit' ? `edit:${context.supplierId}` : 'new'

function read(storage: Storage): SavedSupplierDraft | null {
  const raw = storage.getItem(SUPPLIER_DRAFT_STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<SavedSupplierDraft>
    if (!parsed || typeof parsed !== 'object' || !parsed.context || !parsed.draft) return null
    return parsed as SavedSupplierDraft
  } catch {
    return null
  }
}

/**
 * Thin localStorage-backed autosave for the supplier add/edit form, same
 * reasoning and lifecycle as productDraftStorage.ts: nothing here touches
 * the inventory repository — it exists purely so a half-typed supplier
 * (name, contact, terms, everything on that form) survives switching tabs,
 * the PWA reloading, or simply closing the dialog without meaning to lose
 * the work. It's cleared only by a successful save or by signing out — see
 * SuppliersScreen and App.tsx — never just by hitting Cancel or navigating
 * away.
 */
export function loadSupplierDraftFor(
  context: SupplierDraftContext,
  storage: Storage = localStorage,
): SupplierDraft | null {
  const saved = read(storage)
  if (!saved) return null
  return contextKey(saved.context) === contextKey(context) ? saved.draft : null
}

export function saveSupplierDraft(
  context: SupplierDraftContext,
  draft: SupplierDraft,
  storage: Storage = localStorage,
): void {
  const entry: SavedSupplierDraft = { context, draft, savedAt: new Date().toISOString() }
  storage.setItem(SUPPLIER_DRAFT_STORAGE_KEY, JSON.stringify(entry))
}

export function clearSupplierDraft(storage: Storage = localStorage): void {
  storage.removeItem(SUPPLIER_DRAFT_STORAGE_KEY)
}
