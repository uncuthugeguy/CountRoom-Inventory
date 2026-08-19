import type { Product, ReturnCase, Sale } from './types'
import type { Role } from '../data/repository'

/** Every product field worth calling out in the activity log, paired with
 * the label used in a summary like "qty 12 → 8". Deliberately excludes
 * `id`/`createdAt`/`updatedAt` — those aren't user-facing edits. */
const FIELD_LABELS: [keyof Product, string][] = [
  ['name', 'name'],
  ['sku', 'SKU'],
  ['barcode', 'barcode'],
  ['category', 'category'],
  ['location', 'location'],
  ['variation', 'variation'],
  ['quantity', 'qty'],
  ['reorderLevel', 'reorder level'],
  ['cost', 'cost'],
  ['price', 'price'],
]

/**
 * Human-readable summary of what changed between two versions of the same
 * product, e.g. "qty 12 → 8, price 9.99 → 12.99". Returns an empty string
 * when none of the tracked fields actually differ (e.g. a save with no real
 * edits), so a caller can skip logging a no-op edit entirely.
 */
export function describeProductEdit(before: Product, after: Product): string {
  const changes: string[] = []
  for (const [key, label] of FIELD_LABELS) {
    if (before[key] !== after[key]) {
      changes.push(`${label} ${before[key]} → ${after[key]}`)
    }
  }
  return changes.join(', ')
}

/** A short summary for a brand-new product — enough to identify what was
 * added without repeating the whole product row. */
export function describeProductCreated(product: Product): string {
  const bits = [`qty ${product.quantity}`]
  if (product.price) bits.push(`price ${product.price}`)
  return bits.join(', ')
}

/** A short summary for a just-deleted product — the last thing worth
 * knowing about it once it's gone. */
export function describeProductRemoved(product: Product): string {
  return `had qty ${product.quantity}`
}

// --- Sales -------------------------------------------------------------

/** An identifying label for a sale in the activity log — sales have no
 * name, so this stands in for one: where it sold and what it came to. */
export function saleEntityLabel(sale: Sale): string {
  return `Sale — ${sale.channel || 'Unspecified'} (${sale.subtotal.toFixed(2)})`
}

const itemsSummary = (lines: { quantity: number; sku: string }[]): string =>
  lines.map((l) => `${l.quantity}x ${l.sku}`).join(', ') || 'none'

/**
 * Human-readable summary of what changed between two versions of the same
 * sale, e.g. "channel eBay → Vinted, items 1x SKU-1 → 2x SKU-1". Returns an
 * empty string when nothing tracked actually differs, so a caller can skip
 * logging a no-op edit — same reasoning as describeProductEdit.
 */
export function describeSaleEdit(before: Sale, after: Sale): string {
  const changes: string[] = []
  if (before.channel !== after.channel) {
    changes.push(`channel ${before.channel || 'Unspecified'} → ${after.channel || 'Unspecified'}`)
  }
  if (before.paymentMethod !== after.paymentMethod) {
    changes.push(`payment ${before.paymentMethod} → ${after.paymentMethod}`)
  }
  if (before.subtotal.toFixed(2) !== after.subtotal.toFixed(2)) {
    changes.push(`subtotal ${before.subtotal.toFixed(2)} → ${after.subtotal.toFixed(2)}`)
  }
  const beforeItems = itemsSummary(before.lines)
  const afterItems = itemsSummary(after.lines)
  if (beforeItems !== afterItems) {
    changes.push(`items ${beforeItems} → ${afterItems}`)
  }
  return changes.join(', ')
}

// --- Returns -------------------------------------------------------------

/** An identifying label for a return case — like sales, a case has no name
 * of its own, so this stands in for one. */
export function returnEntityLabel(returnCase: ReturnCase): string {
  return `Return case — ${returnCase.customerRef || returnCase.channel || 'Unspecified'}`
}

const returnLinesSummary = (lines: { quantity: number; sku: string; disposition: string }[]): string =>
  lines.map((l) => `${l.quantity}x ${l.sku} (${l.disposition})`).join(', ') || 'none'

const replacementLinesSummary = (lines: { quantity: number; sku: string }[]): string =>
  lines.map((l) => `${l.quantity}x ${l.sku}`).join(', ') || 'none'

/**
 * Human-readable summary of what changed between two versions of the same
 * return case. Returns an empty string when nothing tracked actually
 * differs, same reasoning as describeSaleEdit/describeProductEdit.
 */
export function describeReturnEdit(before: ReturnCase, after: ReturnCase): string {
  const changes: string[] = []
  const beforeActions = [...before.actions].sort().join('+') || 'none'
  const afterActions = [...after.actions].sort().join('+') || 'none'
  if (beforeActions !== afterActions) {
    changes.push(`actions ${beforeActions} → ${afterActions}`)
  }
  if (before.refundAmount.toFixed(2) !== after.refundAmount.toFixed(2)) {
    changes.push(`refund ${before.refundAmount.toFixed(2)} → ${after.refundAmount.toFixed(2)}`)
  }
  if (before.goodwillValue.toFixed(2) !== after.goodwillValue.toFixed(2)) {
    changes.push(`goodwill ${before.goodwillValue.toFixed(2)} → ${after.goodwillValue.toFixed(2)}`)
  }
  const beforeLines = returnLinesSummary(before.returnLines)
  const afterLines = returnLinesSummary(after.returnLines)
  if (beforeLines !== afterLines) {
    changes.push(`return items ${beforeLines} → ${afterLines}`)
  }
  const beforeReplacements = replacementLinesSummary(before.replacementLines)
  const afterReplacements = replacementLinesSummary(after.replacementLines)
  if (beforeReplacements !== afterReplacements) {
    changes.push(`replacements ${beforeReplacements} → ${afterReplacements}`)
  }
  return changes.join(', ')
}

// --- Team / membership ----------------------------------------------------

/** Detail text for a brand-new invite, or an existing account linked in
 * immediately — see inviteEmployee's own doc comment for the distinction. */
export function describeMemberInvited(role: Role, linkedExistingAccount: boolean): string {
  return linkedExistingAccount ? `role: ${role} (existing account linked)` : `role: ${role}`
}

/** Detail text for removing a team member — the role they held is the last
 * thing worth knowing about a row that's about to disappear from the team list. */
export function describeMemberRemoved(role: Role): string {
  return `was ${role}`
}

/** Detail text for a future "change an existing member's role" action —
 * unused today (see ActivityAction's `role_changed` doc comment) but kept
 * alongside the other member-entity helpers so it's ready when that feature exists. */
export function describeMemberRoleChanged(before: Role, after: Role): string {
  return `role ${before} → ${after}`
}
