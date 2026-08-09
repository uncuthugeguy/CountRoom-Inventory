import type { Role } from '../data/repository'
import type { MovementType, ReturnCaseInput, SaleInput } from './types'

/**
 * What each role can do — the same rules `supabase/schema.sql` enforces
 * server-side (triggers, RLS, and checks inside checkout_sale()/
 * process_return()). Kept here, pure and framework-free, so:
 *
 *  - the UI can decide what to show/disable without duplicating the rules,
 *  - the Supabase repository can give a friendly error immediately instead
 *    of waiting on a round trip to be told no by Postgres, and
 *  - the rules themselves are unit-testable without a database.
 *
 * Local (offline demo) mode is always 'manager' (see Role's doc comment),
 * so every one of these is trivially true there — these only start
 * rejecting anything once a real employee is signed in via Supabase.
 */

export const isManager = (role: Role): boolean => role === 'manager'

export const canDeleteProduct = (role: Role): boolean => isManager(role)

/** Whether a product edit needs a manager — true only when cost or price is
 * actually changing; every other field (name, barcode, location, quantity,
 * reorder level, …) is fine for an employee to update. */
export function productEditNeedsManager(
  draft: { cost: number; price: number },
  existing: { cost: number; price: number } | undefined,
): boolean {
  if (!existing) return true // creating with a non-default cost/price
  return draft.cost !== existing.cost || draft.price !== existing.price
}

export const canApproveStocktake = (role: Role, movementType: MovementType): boolean =>
  movementType !== 'adjust' || isManager(role)

/** Employees ring up sales at the product's own listed price — any
 * deviation (a discount or a markup) needs a manager. */
export function saleNeedsManager(input: SaleInput, priceOf: (productId: string) => number | undefined): boolean {
  return input.lines.some((line) => {
    const listed = priceOf(line.productId)
    return listed !== undefined && line.unitPrice !== listed
  })
}

/** Money leaving the business (refund, goodwill) or stock being written off
 * needs a manager; a plain restock return doesn't. */
export function returnNeedsManager(input: ReturnCaseInput): boolean {
  const actions = input.actions ?? []
  if (actions.includes('refund') || actions.includes('goodwill')) return true
  return (input.returnLines ?? []).some((line) => line.disposition === 'writeoff')
}

export const MANAGER_ONLY = {
  deleteProduct: 'Only a manager can delete a product.',
  editCostOrPrice: 'Only a manager can change what a product costs or sells for.',
  approveStocktake: 'Only a manager can approve a stocktake recount.',
  overridePrice: 'Only a manager can change the sale price — ask them to ring this one up.',
  refundOrGoodwillOrWriteoff:
    'Only a manager can process a refund, goodwill gesture, or write-off.',
  inviteTeam: 'Only a manager can invite team members.',
} as const
