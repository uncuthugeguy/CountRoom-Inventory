import type {
  ExpectedReturnItem,
  PaymentMethod,
  Product,
  Sale,
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
  // "Inspect first" is the default, same as Register.
  return [...cart, { product, quantity: 1, disposition: 'inspect' }]
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
  /** Return postage label cost — independent of which actions are ticked. */
  returnPostageCost?: number | null
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
    returnPostageCost:
      draft.returnPostageCost !== null && draft.returnPostageCost !== undefined ? draft.returnPostageCost : undefined,
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
  const hasPostage = typeof input.returnPostageCost === 'number' && input.returnPostageCost > 0
  return !(hasAction || hasReturnLines || hasReplacementLines || hasRefund || hasGoodwill || hasNote || hasPostage)
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

  if (
    input.returnPostageCost !== undefined &&
    (!Number.isFinite(input.returnPostageCost) || input.returnPostageCost < 0)
  ) {
    return fail('Return postage cost must be zero or greater.')
  }

  return ok(true)
}

// --- Financial impact & reporting --------------------------------------

export interface ReturnImpact {
  refundTotal: number
  goodwillTotal: number
  /** Cost value of returned stock that didn't come back sellable — shown
   * for information; NOT added to totalCost (see below). */
  writeOffLoss: number
  /** Cost value of returned stock put back on the shelf. */
  restockedValue: number
  replacementCost: number
  /** Return postage label you paid for. */
  returnPostage: number
  /** What this case took off profit: refunds + goodwill + replacements sent
   * + return postage − stock recovered. A returned item's cost was already deducted from the
   * original sale's profit when it sold, so a written-off item costs
   * nothing extra here (counting it again double-counted it), and a
   * restocked one gives that cost back. */
  totalCost: number
}

export function returnImpact(
  rc: Pick<ReturnCase, 'refundAmount' | 'goodwillValue' | 'returnLines' | 'replacementLines' | 'returnPostageCost'>,
): ReturnImpact {
  const returnPostage = rc.returnPostageCost ?? 0
  const writeOffLoss = rc.returnLines
    .filter((line) => line.disposition === 'writeoff')
    .reduce((sum, line) => sum + line.unitCost * line.quantity, 0)
  const restockedValue = rc.returnLines
    .filter((line) => line.disposition === 'restock')
    .reduce((sum, line) => sum + line.unitCost * line.quantity, 0)
  const replacementCost = rc.replacementLines.reduce((sum, line) => sum + line.unitCost * line.quantity, 0)

  return {
    refundTotal: rc.refundAmount,
    goodwillTotal: rc.goodwillValue,
    writeOffLoss,
    restockedValue,
    replacementCost,
    returnPostage,
    totalCost: rc.refundAmount + rc.goodwillValue + replacementCost + returnPostage - restockedValue,
  }
}

export interface ReturnsSummary {
  caseCount: number
  refundTotal: number
  goodwillTotal: number
  writeOffLoss: number
  restockedValue: number
  replacementCost: number
  returnPostage: number
  totalCost: number
  itemsRestocked: number
  itemsWrittenOff: number
  itemsAwaitingInspection: number
}

const EMPTY_SUMMARY: ReturnsSummary = {
  caseCount: 0,
  refundTotal: 0,
  goodwillTotal: 0,
  writeOffLoss: 0,
  restockedValue: 0,
  replacementCost: 0,
  returnPostage: 0,
  totalCost: 0,
  itemsRestocked: 0,
  itemsWrittenOff: 0,
  itemsAwaitingInspection: 0,
}

export function summariseReturns(cases: ReturnCase[]): ReturnsSummary {
  return cases.reduce<ReturnsSummary>((totals, rc) => {
    const impact = returnImpact(rc)
    return {
      caseCount: totals.caseCount + 1,
      refundTotal: totals.refundTotal + impact.refundTotal,
      goodwillTotal: totals.goodwillTotal + impact.goodwillTotal,
      writeOffLoss: totals.writeOffLoss + impact.writeOffLoss,
      restockedValue: totals.restockedValue + impact.restockedValue,
      replacementCost: totals.replacementCost + impact.replacementCost,
      returnPostage: totals.returnPostage + impact.returnPostage,
      totalCost: totals.totalCost + impact.totalCost,
      itemsRestocked:
        totals.itemsRestocked +
        rc.returnLines.filter((l) => l.disposition === 'restock').reduce((n, l) => n + l.quantity, 0),
      itemsWrittenOff:
        totals.itemsWrittenOff +
        rc.returnLines.filter((l) => l.disposition === 'writeoff').reduce((n, l) => n + l.quantity, 0),
      itemsAwaitingInspection:
        totals.itemsAwaitingInspection +
        rc.returnLines.filter((l) => l.disposition === 'inspect').reduce((n, l) => n + l.quantity, 0),
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

// --- Shared with CountRoom Register ----------------------------------------
//
// Both apps write to the same returns tables. Register records actions as
// refund / goodwill / replace / restock / writeoff; Inventory's older
// process_return used refund / return / replacement / goodwill. Everything
// read back is normalised to Inventory's four so the two display the same.

const ACTION_ALIASES: Record<string, ReturnAction> = {
  refund: 'refund',
  goodwill: 'goodwill',
  return: 'return',
  restock: 'return',
  writeoff: 'return',
  inspect: 'return',
  replacement: 'replacement',
  replace: 'replacement',
}

export function normaliseReturnActions(raw: readonly string[] | null | undefined): ReturnAction[] {
  const out: ReturnAction[] = []
  for (const a of raw ?? []) {
    const mapped = ACTION_ALIASES[a]
    if (mapped && !out.includes(mapped)) out.push(mapped)
  }
  return out
}

/** The action list for a case, worked out from what's actually in it
 * rather than ticked by hand — the way Register does it. */
export function deriveReturnActions(input: {
  returnLines?: unknown[]
  replacementLines?: unknown[]
  refundAmount?: number
  goodwillValue?: number
}): ReturnAction[] {
  const actions: ReturnAction[] = []
  if ((input.refundAmount ?? 0) > 0) actions.push('refund')
  if ((input.returnLines?.length ?? 0) > 0) actions.push('return')
  if ((input.replacementLines?.length ?? 0) > 0) actions.push('replacement')
  if ((input.goodwillValue ?? 0) > 0) actions.push('goodwill')
  return actions
}

/** Register's own action words for the shared create_register_return RPC. */
export function registerActionsFor(input: ReturnCaseInput): string[] {
  const actions: string[] = []
  if ((input.refundAmount ?? 0) > 0) actions.push('refund')
  if (input.goodwillType && (input.goodwillValue ?? 0) > 0) actions.push('goodwill')
  if ((input.replacementLines?.length ?? 0) > 0) actions.push('replace')
  if (input.returnLines?.some((l) => l.disposition === 'restock')) actions.push('restock')
  if (input.returnLines?.some((l) => l.disposition === 'writeoff')) actions.push('writeoff')
  return actions
}

/** Status of a case — records with no status (demo/local) are complete. */
export const caseStatus = (rc: ReturnCase) => rc.status ?? 'completed'

export const isOpenReturn = (rc: ReturnCase) =>
  caseStatus(rc) === 'awaiting_item' || caseStatus(rc) === 'awaiting_refund'

/** Returns still part-way through the three stages, oldest label first. */
export function openReturns(cases: ReturnCase[]): ReturnCase[] {
  return cases
    .filter(isOpenReturn)
    .sort((a, b) => (a.labelSentAt ?? a.createdAt).localeCompare(b.labelSentAt ?? b.createdAt))
}

export interface PendingInspection {
  lineId: string
  returnId: string
  productId: string
  sku: string
  name: string
  quantity: number
  returnedAt: string
  receiptRef?: string
}

/** Returned items marked "Inspect first" that nobody has restocked or
 * written off yet — whichever app they came back through. */
export function pendingInspections(cases: ReturnCase[]): PendingInspection[] {
  const out: PendingInspection[] = []
  for (const rc of cases) {
    for (const line of rc.returnLines) {
      if (line.disposition !== 'inspect') continue
      out.push({
        lineId: line.id,
        returnId: rc.id,
        productId: line.productId,
        sku: line.sku,
        name: line.name,
        quantity: line.quantity,
        returnedAt: line.createdAt ?? rc.itemReceivedAt ?? rc.createdAt,
        receiptRef: rc.receiptRef,
      })
    }
  }
  return out.sort((a, b) => a.returnedAt.localeCompare(b.returnedAt))
}

/** Only a finished case with nothing waiting for inspection can go through
 * the manager "Edit case" rebuild — the edit reverses and reapplies stock,
 * which doesn't apply to a return that's still in progress. */
export function canEditReturn(rc: ReturnCase): boolean {
  return caseStatus(rc) === 'completed' && !rc.returnLines.some((l) => l.disposition === 'inspect')
}

/** The items a case is about: what came back, or (before it arrives) what's expected. */
export function caseItems(rc: ReturnCase): { sku: string; name: string; quantity: number; productId: string }[] {
  if (rc.returnLines.length > 0) return rc.returnLines
  return rc.expectedItems ?? []
}

/**
 * Finds return cases by returns-receipt number (typed or scanned — spaces
 * and dashes ignored, partial numbers match), the original sale's order
 * number or receipt reference, an item's barcode, SKU or name, or the
 * customer. Searches everything passed in, regardless of date range.
 * Register's returns search (apps/register/src/lib/returns.ts) matches the
 * same fields.
 */
export function searchReturns(
  cases: ReturnCase[],
  query: string,
  products: Product[] = [],
  sales: Sale[] = [],
): ReturnCase[] {
  const q = query.trim().toLowerCase()
  if (!q) return cases
  const compact = (value: string) => value.toLowerCase().replace(/[\s-]/g, '')
  const qc = compact(q)
  const saleById = new Map(sales.map((sale) => [sale.id, sale]))
  const barcodeByProduct = new Map(products.map((p) => [p.id, compact(p.barcode ?? '')]))

  return cases.filter((rc) => {
    if (qc && rc.receiptRef && compact(rc.receiptRef).includes(qc)) return true
    if (rc.id.toLowerCase().startsWith(q)) return true
    const sale = rc.saleId ? saleById.get(rc.saleId) : undefined
    if (qc && sale?.orderNumber && compact(sale.orderNumber).includes(qc)) return true
    if (qc && sale?.clientRef && compact(sale.clientRef).includes(qc)) return true
    if (rc.customerRef.toLowerCase().includes(q)) return true
    const items: { productId: string; sku: string; name: string }[] = [
      ...rc.returnLines,
      ...rc.replacementLines,
      ...(rc.expectedItems ?? []),
    ]
    return items.some(
      (item) =>
        (qc !== '' && barcodeByProduct.get(item.productId) === qc) ||
        item.sku.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q),
    )
  })
}

// --- Stage inputs ------------------------------------------------------------

export interface ReceivedReturnLine {
  productId: string
  quantity: number
  disposition: StockDisposition
}

export interface CompleteReturnInput {
  refundAmount?: number
  refundMethod?: PaymentMethod
  goodwillType?: string
  goodwillValue?: number
  notes?: string
  replacementLines?: ReplacementLineInput[]
}

export function expectedItemsFrom(cart: ReturnCart): ExpectedReturnItem[] {
  return cart.map((line) => ({
    productId: line.product.id,
    sku: line.product.sku,
    name: line.product.name,
    quantity: line.quantity,
  }))
}

/** True when a finished case was changed after it was finished (the manager
 * "Edit case" rebuild) — not when it merely moved through its stages or had
 * an item inspected, which also touch updatedAt. */
export function wasEdited(rc: ReturnCase): boolean {
  if (!rc.updatedAt || caseStatus(rc) !== 'completed') return false
  const marks = [rc.createdAt, rc.completedAt, ...rc.returnLines.map((l) => l.inspectedAt)]
    .filter((v): v is string => !!v)
    .map((v) => new Date(v).getTime())
  return new Date(rc.updatedAt).getTime() > Math.max(...marks)
}
