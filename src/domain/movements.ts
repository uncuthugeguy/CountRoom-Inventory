import type { MovementInput, Product, Result, StockMovement } from './types'

const ok = <T,>(value: T): Result<T> => ({ ok: true, value })
const fail = (error: string): Result<never> => ({ ok: false, error })

/**
 * Checks a movement against the product it will be applied to. Returns the
 * signed change to the quantity on hand when the movement is legal.
 */
export function validateMovement(product: Product, input: MovementInput): Result<number> {
  const { type, quantity } = input

  if (!Number.isInteger(quantity)) {
    return fail('Quantity must be a whole number.')
  }

  switch (type) {
    case 'in':
      if (quantity <= 0) return fail('Quantity must be greater than zero.')
      return ok(quantity)

    case 'out':
      if (quantity <= 0) return fail('Quantity must be greater than zero.')
      if (quantity > product.quantity) {
        return fail(`Cannot remove ${quantity} — only ${product.quantity} in stock.`)
      }
      return ok(-quantity)

    case 'adjust':
      if (quantity < 0) return fail('Counted quantity cannot be negative.')
      return ok(quantity - product.quantity)

    default:
      return fail(`Unknown movement type: ${String(type)}`)
  }
}

export interface MovementStamp {
  id: string
  at: string
}

export interface AppliedMovement {
  product: Product
  movement: StockMovement
}

/**
 * Applies a movement to a product without mutating it, producing the updated
 * product plus the audit record describing the change.
 */
export function applyMovement(
  product: Product,
  input: MovementInput,
  stamp: MovementStamp = { id: crypto.randomUUID(), at: new Date().toISOString() },
): Result<AppliedMovement> {
  const validated = validateMovement(product, input)
  if (!validated.ok) return validated

  const delta = validated.value
  const previousQuantity = product.quantity
  const newQuantity = previousQuantity + delta

  const movement: StockMovement = {
    id: stamp.id,
    productId: product.id,
    type: input.type,
    quantity: input.quantity,
    delta,
    previousQuantity,
    newQuantity,
    createdAt: stamp.at,
  }
  if (input.reason?.trim()) movement.reason = input.reason.trim()

  return ok({
    product: { ...product, quantity: newQuantity, updatedAt: stamp.at },
    movement,
  })
}
