import type { Product } from './types'

/**
 * Tallies how many times each code appears in a pasted scanner dump. A
 * storage-mode scanner spits its memory out as a burst of keystrokes — one
 * code per line (occasionally comma/tab separated depending on the model) —
 * so this splits on any of those separators and ignores blank entries.
 */
export function parseBarcodeDump(text: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const raw of text.split(/[\r\n\t,;]+/)) {
    const code = raw.trim()
    if (!code) continue
    counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  return counts
}

export interface StocktakeLine {
  barcode: string
  product: Product
  /** How many times this barcode was scanned in the dump. */
  counted: number
  /** The quantity on hand for this product before the stocktake is applied. */
  systemQuantity: number
  /** counted - systemQuantity. Positive means more were counted than expected. */
  difference: number
}

export interface UnmatchedCode {
  barcode: string
  counted: number
}

export interface StocktakeResult {
  lines: StocktakeLine[]
  /** Scanned codes that don't match any product's barcode. */
  unmatched: UnmatchedCode[]
}

/**
 * Matches tallied barcode counts against the catalogue. Barcodes that don't
 * match a product's barcode field come back separately as `unmatched` so the
 * user can review a mis-scan or add a new product for it, rather than being
 * silently dropped.
 */
export function buildStocktakeLines(counts: Map<string, number>, products: Product[]): StocktakeResult {
  const byBarcode = new Map<string, Product>()
  for (const product of products) {
    if (product.barcode) byBarcode.set(product.barcode, product)
  }

  const lines: StocktakeLine[] = []
  const unmatched: UnmatchedCode[] = []

  for (const [barcode, counted] of counts) {
    const product = byBarcode.get(barcode)
    if (!product) {
      unmatched.push({ barcode, counted })
      continue
    }
    lines.push({
      barcode,
      product,
      counted,
      systemQuantity: product.quantity,
      difference: counted - product.quantity,
    })
  }

  // Worst discrepancies first — that's what the user is looking for — ties
  // broken alphabetically so the order is stable and easy to scan on paper.
  lines.sort(
    (a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.product.name.localeCompare(b.product.name),
  )
  unmatched.sort((a, b) => a.barcode.localeCompare(b.barcode))

  return { lines, unmatched }
}
