import type {
  PaymentMethod,
  Product,
  ReplacementLineInput,
  Result,
  ReturnAction,
  ReturnCase,
  ReturnCaseInput,
  ReturnLineInput,
  StockDisposition,
} from './types'

const ok = <T,>(value: T): Result<T> => ({ ok: true, value })
const fail = (error: string): Result<never> => ({ ok: false, error })

// --- Working state while a case is being built in the UI -------------------
//
// Mirrors the Cart / CartLine pattern in sales.ts: the two line lists carry
// real Product objects while the case is in progress, and get flattened to
// plain ids at submit time. Everything else (actions, refund, goodwill,
// notes) is plain component state, combined in with the two carts by
// buildReturnCaseInput.

/** A returned item in progress — the item itself for a plain return, or the
 * "old" side of a replacement. */
export interface ReturnCartLine {
  product: Product
  quantity: number
  disposition: StockDisposition
}

export type ReturnCart = ReturnCartLine[]

export const emptyReturnCart = (): ReturnCart => []

export function addReturnLine(cart: ReturnCart, product: Product): ReturnCart {
  if (cart.some((line) => line.product.id === product.id)) return cart
  return [...cart, { product, quantity: 1, disposition: 'restock' }]
}

export function removeReturnLine(cart: ReturnCart, productId: string): ReturnCart {
  return cart.filter((line) => line.product.id !== productId)
}

/** A quantity of zero or less removes the line entirely, same as the sales cart. */
export function setReturnLineQuantity(cart: ReturnCart, productId: string, quantity: number): ReturnCart {
  if (quantity <= 0) return removeReturnLine(cart, productId)
  return cart.map((line) => (line.product.id === productId ? { ...line, quantity } : line))
}

export function setReturnLineDisposition(
  cart: ReturnCart,
  productId: string,
  disposition: StockDisposition,
): ReturnCart {
  return cart.map((line) => (line.product.id === productId ? { ...line, disposition } : line))
}

/** One item going back out to the customer — the "new" side of a
 * replacement. Decrements stock exactly like a sale line, but at no charge. */
export interface ReplacementCartLine {
  product: Product
  quantity: number
}

export type ReplacementCart = ReplacementCartLine[]

export const emptyReplacementCart = (): ReplacementCart => []

export function addReplacementLine(cart: ReplacementCart, product: Product): ReplacementCart {
  if (cart.some((line) => line.product.id === product.id)) return cart
  return [...cart, { product, quantity: 1 }]
}

export function removeReplacementLine(cart: ReplacementCart, productId: string): ReplacementCart {
  return cart.filter((line) => line.product.id !== productId)
}

export function setReplacementLineQuantity(
  cart: ReplacementCart,
  productId: string,
  quantity: number,
): ReplacementCart {
  if (quantity <= 0) return removeReplacementLine(cart, productId)
  return cart.map((line) => (line.product.id === productId ? { ...line, quantity } : line))
}

/** A replacement line oversells when it wants more than is currently on hand
 * — giving away stock you don't have isn't possible even at no charge. */
export function replacementLineIssue(line: ReplacementCartLine): string | null {
  if (line.quantity > line.product.quantity) {
    return `Only ${line.product.quantity} in stock.`
  }
  return null
}

export function replacementCartHasIssues(cart: ReplacementCart): boolean {
  return cart.some((line) => replacementLineIssue(line) !== null)
}

/** Rebuilds an editable return cart from a previously recorded case, looking
 * up each line's current Product by id. A line whose product has since been
 * deleted is dropped, the same way buildEditCart handles a sale. */
export function buildEditReturnCart(rc: ReturnCase, products: Product[]): ReturnCart {
  const byId = new Map(products.map((p) => [p.id, p]))
  const lines: ReturnCart = []
  for (const line of rc.returnLines) {
    const product = byId.get(line.productId)
    if (!product) continue
    lines.push({ product, quantity: line.quantity, disposition: line.disposition })
  }
  return lines
}

/** Same idea for the replacement side of a case. */
export function buildEditReplacementCart(rc: ReturnCase, products: Product[]): ReplacementCart {
  const byId = new Map(products.map((p) => [p.id, p]))
  const lines: ReplacementCart = []
  for (const line of rc.replacementLines) {
    const product = byId.get(line.productId)
    if (!product) continue
    lines.push({ product, quantity: line.quantity })
  }
  return lines
}

/** Stock available for a product while editing this case's replacement
 * lines, as if the case's original replacement lines had already been
 * reversed — mirrors the backend's reverse-then-reapply on save, so the
 * warning doesn't fire for a line that hasn't actually changed. */
export function editableReplacementStock(product: Product, originalCase: ReturnCase): number {
  const original = originalCase.replacementLines
    .filter((line) => line.productId === product.id)
    .reduce((sum, line) => sum + line.quantity, 0)
  return product.quantity + original
}

export function editReplacementLineIssue(line: ReplacementCartLine, originalCase: ReturnCase): string | null {
  const available = editableReplacementStock(line.product, originalCase)
  if (line.quantity > available) {
    return `Only ${available} in stock.`
  }
  return null
}

export function editReplacementCartHasIssues(cart: ReplacementCart, originalCase: ReturnCase): boolean {
  return cart.some((line) => editReplacementLineIssue(line, originalCase) !== null)
}

export interface ReturnCaseDraft {
  saleId: string
  channel: string
  customerRef: string
  reason: string
  notes: string
  actions: ReturnAction[]
  refundAmount: number | null
  refundMethod: PaymentMethod
  goodwillType: string
  goodwillValue: number | null
}

/** Combines the two carts and the rest of the form into the payload the
 * repository expects. Fields for an action the user didn't select are
 * dropped rather than sent as zero, so an unrelated refund amount typed and
 * then abandoned never lands in the record. */
export function buildReturnCaseInput(
  returnCart: ReturnCart,
  replacementCart: ReplacementCart,
  draft: ReturnCaseDraft,
): ReturnCaseInput {
  const hasAction = (action: ReturnAction) => draft.actions.includes(action)

  return {
    saleId: draft.saleId.trim() || undefined,
    channel: draft.channel.trim() || undefined,
    customerRef: draft.customerRef.trim() || undefined,
    reason: draft.reason.trim() || undefined,
    notes: draft.notes.trim() || undefined,
    actions: draft.actions,
    refundAmount: hasAction('refund') && draft.refundAmount !== null ? draft.refundAmount : undefined,
    refundMethod: hasAction('refund') ? draft.refundMethod : undefined,
    goodwillType: hasAction('goodwill') ? draft.goodwillType.trim() || undefined : undefined,
    goodwillValue: hasAction('goodwill') && draft.goodwillValue !== null ? draft.goodwillValue : undefined,
    returnLines: returnCart.map((line) => ({
      productId: line.product.id,
      quantity: line.quantity,
      disposition: line.disposition,
    })),
    replacementLines: replacementCart.map((line) => ({
      productId: line.product.id,
      quantity: line.quantity,
    })),
  }
}

// --- Validation --------------------------------------------------------

/** A case with nothing at all recorded — no action, no item, no refund, no
 * note — has no audit value, so it's the one thing that's rejected. Every
 * individual field otherwise stays optional. */
function isCaseEmpty(input: ReturnCaseInput): boolean {
  const hasAction = (input.actions?.length ?? 0) > 0
  const hasReturnLines = (input.returnLines?.length ?? 0) > 0
  const hasReplacementLines = (input.replacementLines?.length ?? 0) > 0
  const hasRefund = typeof input.refundAmount === 'number' && input.refundAmount > 0
  const hasGoodwill =
    (typeof input.goodwillValue === 'number' && input.goodwillValue > 0) || !!input.goodwillType?.trim()
  const hasNote = !!(input.reason?.trim() || input.notes?.trim())
  return !(hasAction || hasReturnLines || hasReplacementLines || hasRefund || hasGoodwill || hasNote)
}

export function validateReturnLineInput(line: ReturnLineInput): string | null {
  if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
    return 'Returned item quantity must be a whole number greater than zero.'
  }
  return null
}

export function validateReplacementLineInput(line: ReplacementLineInput): string | null {
  if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
    return 'Replacement item quantity must be a whole number greater than zero.'
  }
  return null
}

export function validateReturnCaseInput(input: ReturnCaseInput): Result<true> {
  if (isCaseEmpty(input)) {
    return fail('Add at least one action, item, refund, or note before saving.')
  }

  for (const line of input.returnLines ?? []) {
    const issue = validateReturnLineInput(line)
    if (issue) return fail(issue)
  }

  for (const line of input.replacementLines ?? []) {
    const issue = validateReplacementLineInput(line)
    if (issue) return fail(issue)
  }

  if (input.refundAmount !== undefined && (!Number.isFinite(input.refundAmount) || input.refundAmount < 0)) {
    return fail('Refund amount must be zero or greater.')
  }

  if (input.goodwillValue !== undefined && (!Number.isFinite(input.goodwillValue) || input.goodwillValue < 0)) {
    return fail('Goodwill value must be zero or greater.')
  }

  return ok(true)
}

// --- Financial impact & reporting --------------------------------------

export interface ReturnImpact {
  refundTotal: number
  goodwillTotal: number
  writeOffLoss: number
  replacementCost: number
  /** What this case cost the business overall — refunds and goodwill paid
   * out, plus the cost value of stock that didn't come back sellable. */
  totalCost: number
}

export function returnImpact(
  rc: Pick<ReturnCase, 'refundAmount' | 'goodwillValue' | 'returnLines' | 'replacementLines'>,
): ReturnImpact {
  const writeOffLoss = rc.returnLines
    .filter((line) => line.disposition === 'writeoff')
    .reduce((sum, line) => sum + line.unitCost * line.quantity, 0)
  const replacementCost = rc.replacementLines.reduce((sum, line) => sum + line.unitCost * line.quantity, 0)

  return {
    refundTotal: rc.refundAmount,
    goodwillTotal: rc.goodwillValue,
    writeOffLoss,
    replacementCost,
    totalCost: rc.refundAmount + rc.goodwillValue + writeOffLoss + replacementCost,
  }
}

export interface ReturnsSummary {
  caseCount: number
  refundTotal: number
  goodwillTotal: number
  writeOffLoss: number
  replacementCost: number
  totalCost: number
  itemsRestocked: number
  itemsWrittenOff: number
}

const EMPTY_SUMMARY: ReturnsSummary = {
  caseCount: 0,
  refundTotal: 0,
  goodwillTotal: 0,
  writeOffLoss: 0,
  replacementCost: 0,
  totalCost: 0,
  itemsRestocked: 0,
  itemsWrittenOff: 0,
}

export function summariseReturns(cases: ReturnCase[]): ReturnsSummary {
  return cases.reduce<ReturnsSummary>((totals, rc) => {
    const impact = returnImpact(rc)
    return {
      caseCount: totals.caseCount + 1,
      refundTotal: totals.refundTotal + impact.refundTotal,
      goodwillTotal: totals.goodwillTotal + impact.goodwillTotal,
      writeOffLoss: totals.writeOffLoss + impact.writeOffLoss,
      replacementCost: totals.replacementCost + impact.replacementCost,
      totalCost: totals.totalCost + impact.totalCost,
      itemsRestocked:
        totals.itemsRestocked +
        rc.returnLines.filter((l) => l.disposition === 'restock').reduce((n, l) => n + l.quantity, 0),
      itemsWrittenOff:
        totals.itemsWrittenOff +
        rc.returnLines.filter((l) => l.disposition === 'writeoff').reduce((n, l) => n + l.quantity, 0),
    }
  }, EMPTY_SUMMARY)
}

/** Cases at or after the given instant, inclusive — same convention as salesSince. */
export function returnsSince(cases: ReturnCase[], since: Date): ReturnCase[] {
  const cutoff = since.getTime()
  return cases.filter((rc) => new Date(rc.createdAt).getTime() >= cutoff)
}

export function breakdownByAction(cases: ReturnCase[]): Record<ReturnAction, number> {
  const counts: Record<ReturnAction, number> = { refund: 0, return: 0, replacement: 0, goodwill: 0 }
  for (const rc of cases) {
    for (const action of rc.actions) {
      counts[action] += 1
    }
  }
  return counts
}
