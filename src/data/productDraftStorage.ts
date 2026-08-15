import type { ProductDraft } from '../domain/types'

export const PRODUCT_DRAFT_STORAGE_KEY = 'stockflow.productDraft.v1'

/**
 * Identifies which product a saved draft belongs to — a specific existing
 * product being edited, or a brand new one (optionally pre-filled from a
 * barcode scan). Only one product dialog can ever be open at a time, so
 * there's only ever one draft worth keeping.
 */
export type ProductDraftContext = { kind: 'new' } | { kind: 'edit'; productId: string }

interface SavedProductDraft {
  context: ProductDraftContext
  draft: ProductDraft
  savedAt: string
}

const contextKey = (context: ProductDraftContext): string =>
  context.kind === 'edit' ? `edit:${context.productId}` : 'new'

function read(storage: Storage): SavedProductDraft | null {
  const raw = storage.getItem(PRODUCT_DRAFT_STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<SavedProductDraft>
    if (!parsed || typeof parsed !== 'object' || !parsed.context || !parsed.draft) return null
    return parsed as SavedProductDraft
  } catch {
    return null
  }
}

/**
 * Thin localStorage-backed autosave for the product add/edit form. Nothing
 * here touches the inventory repository — it exists purely so a half-typed
 * edit (cost, price, quantity, everything on that form) survives switching
 * tabs, the phone backgrounding the PWA and reloading it later, or simply
 * closing the dialog without meaning to lose the work. It's cleared only by
 * a successful save or by signing out — see ProductFormDialog and App.tsx —
 * never just by navigating away or closing the dialog.
 */
export function loadProductDraftFor(
  context: ProductDraftContext,
  storage: Storage = localStorage,
): ProductDraft | null {
  const saved = read(storage)
  if (!saved) return null
  return contextKey(saved.context) === contextKey(context) ? saved.draft : null
}

export function saveProductDraft(
  context: ProductDraftContext,
  draft: ProductDraft,
  storage: Storage = localStorage,
): void {
  const entry: SavedProductDraft = { context, draft, savedAt: new Date().toISOString() }
  storage.setItem(PRODUCT_DRAFT_STORAGE_KEY, JSON.stringify(entry))
}

export function clearProductDraft(storage: Storage = localStorage): void {
  storage.removeItem(PRODUCT_DRAFT_STORAGE_KEY)
}
