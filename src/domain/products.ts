import type { Product, ProductDraft, Result } from './types'

export function emptyDraft(barcode = ''): ProductDraft {
  return {
    barcode,
    sku: '',
    name: '',
    category: '',
    location: '',
    variation: '',
    quantity: 0,
    reorderLevel: 0,
    cost: 0,
    price: 0,
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
    variation: draft.variation.trim(),
  }
}

export function validateDraft(draft: ProductDraft): Result<ProductDraft> {
  const clean = normaliseDraft(draft)

  // Barcode is optional: not every product carries a manufacturer barcode.
  if (!clean.sku) return { ok: false, error: 'SKU is required.' }
  if (!clean.name) return { ok: false, error: 'Name is required.' }

  for (const [label, value] of [
    ['Quantity', clean.quantity],
    ['Reorder level', clean.reorderLevel],
  ] as const) {
    if (!Number.isInteger(value)) return { ok: false, error: `${label} must be a whole number.` }
    if (value < 0) return { ok: false, error: `${label} cannot be negative.` }
  }

  // Cost and price carry decimals (currency), so only quantity fields require
  // a whole number above.
  for (const [label, value] of [
    ['Cost', clean.cost],
    ['Price', clean.price],
  ] as const) {
    if (!Number.isFinite(value)) return { ok: false, error: `${label} must be a number.` }
    if (value < 0) return { ok: false, error: `${label} cannot be negative.` }
  }

  return { ok: true, value: clean }
}

const SKU_PATTERN = /^SKU-(\d+)$/i

/**
 * Finds the next SKU in the `SKU-NNN` sequence, continuing from whatever the
 * highest existing one is (e.g. SKU-018 already used → SKU-019 next). Starts
 * at SKU-001 when no product yet follows the pattern.
 */
export function nextSku(products: Product[]): string {
  const highest = products.reduce((max, product) => {
    const match = SKU_PATTERN.exec(product.sku.trim())
    if (!match) return max
    return Math.max(max, Number(match[1]))
  }, 0)
  return `SKU-${String(highest + 1).padStart(3, '0')}`
}

/** Distinct variation values already in use, for the "previously used" dropdown. */
export function knownVariations(products: Product[]): string[] {
  const seen = new Set<string>()
  for (const product of products) {
    const value = product.variation.trim()
    if (value) seen.add(value)
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}
