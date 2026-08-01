import type { ProductDraft, Result } from './types'

export function emptyDraft(barcode = ''): ProductDraft {
  return {
    barcode,
    sku: '',
    name: '',
    category: '',
    location: '',
    quantity: 0,
    reorderLevel: 0,
  }
}

/** Trims the text fields; barcodes arrive from scanners with trailing newlines. */
export function normaliseDraft(draft: ProductDraft): ProductDraft {
  return {
    ...draft,
    barcode: draft.barcode.trim(),
    sku: draft.sku.trim(),
    name: draft.name.trim(),
    category: draft.category.trim(),
    location: draft.location.trim(),
  }
}

export function validateDraft(draft: ProductDraft): Result<ProductDraft> {
  const clean = normaliseDraft(draft)

  if (!clean.barcode) return { ok: false, error: 'Barcode is required.' }
  if (!clean.sku) return { ok: false, error: 'SKU is required.' }
  if (!clean.name) return { ok: false, error: 'Name is required.' }

  for (const [label, value] of [
    ['Quantity', clean.quantity],
    ['Reorder level', clean.reorderLevel],
  ] as const) {
    if (!Number.isInteger(value)) return { ok: false, error: `${label} must be a whole number.` }
    if (value < 0) return { ok: false, error: `${label} cannot be negative.` }
  }

  return { ok: true, value: clean }
}
