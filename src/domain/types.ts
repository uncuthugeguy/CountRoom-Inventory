export interface Product {
  id: string
  /** A manufacturer barcode; not every line has one, so this may be blank. */
  barcode: string
  sku: string
  name: string
  category: string
  location: string
  /** Colour, size or similar — free text, offered as a dropdown of prior values. */
  variation: string
  quantity: number
  reorderLevel: number
  /** What this unit costs you — the basis for profit/loss at checkout. */
  cost: number
  /** Default sale price; checkout pre-fills this but can override it per sale. */
  price: number
  createdAt: string
  updatedAt: string
}

/** Fields a user supplies when creating or editing a product. */
export type ProductDraft = Omit<Product, 'id' | 'createdAt' | 'updatedAt'>

export type MovementType = 'in' | 'out' | 'adjust'

export interface MovementInput {
  type: MovementType
  /**
   * For `in` and `out` this is the magnitude to add or remove.
   * For `adjust` this is the new absolute count on hand (a stocktake).
   */
  quantity: number
  reason?: string
}

export interface StockMovement {
  id: string
  productId: string
  type: MovementType
  /** The quantity as entered by the user (see MovementInput). */
  quantity: number
  /** Signed change applied to the quantity on hand. */
  delta: number
  previousQuantity: number
  newQuantity: number
  reason?: string
  createdAt: string
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  in: 'Stock in',
  out: 'Stock out',
  adjust: 'Adjust',
}

export type PaymentMethod = 'cash' | 'card' | 'other'

export const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'card', 'other']

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  other: 'Other',
}

/** One line of a sale as submitted to the repository. */
export interface SaleLineInput {
  productId: string
  quantity: number
  /** The price actually charged for this line — may differ from the product's default. */
  unitPrice: number
}

/** Who actually paid a given fee — a Vinted/eBay-style listing can go either
 * way for both delivery and the platform's own "Buyer Protection"-style fee
 * (the seller can absorb either to make a listing look cheaper, or pass it
 * straight on to the buyer). Only a 'seller'-paid fee counts as an expense
 * against profit; a 'buyer'-paid one passes straight through and never
 * touches what the seller keeps. Shared by `deliveryPaidBy` and
 * `buyerProtectionFeePaidBy` below since the choice means the same thing
 * either way. */
export type PaidBy = 'seller' | 'buyer'

export const PAID_BY_LABELS: Record<PaidBy, string> = {
  seller: 'Me',
  buyer: 'Buyer',
}

/**
 * Order-level marketplace fees on top of the item price itself — the kind a
 * platform like Vinted or eBay charges per order rather than per line item.
 * Every field is optional because most channels (cash, walk-in, a private
 * FB Marketplace sale) have none of these at all; a repository treats a
 * missing amount as 0 and a missing `deliveryPaidBy` as 'seller'.
 */
export interface SaleFeesFields {
  /** Charged to the buyer by some platforms as an add-on to the item price
   * (Vinted calls this "Buyer Protection"). Recorded here because on some
   * platforms/sellers it's deducted from the payout rather than being
   * purely buyer-side — see the checkout screen's own note on this. */
  buyerProtectionFee?: number
  /** Who actually paid the buyer protection fee — same seller/buyer choice
   * as `deliveryPaidBy`, and nets against profit the same way. Defaults to
   * 'seller'. */
  buyerProtectionFeePaidBy?: PaidBy
  deliveryCost?: number
  /** Who actually paid for delivery — determines whether `deliveryCost`
   * reduces profit (seller-paid) or is cost-neutral to the seller (buyer
   * paid it themselves, on top of the item price). Defaults to 'seller'. */
  deliveryPaidBy?: PaidBy
  /** VAT owed on this sale — reduces what you actually keep. */
  vat?: number
  /** What you spent promoting this specific listing (a boosted/promoted
   * listing fee, an ad campaign, etc.) — always comes out of your pocket. */
  advertisingCost?: number
  /** The total the buyer actually paid, exactly as shown on the
   * marketplace's own order summary — kept purely for reconciling against
   * that summary. Does not feed into the profit calculation, which is
   * derived from the line items and the fee fields above instead. */
  orderTotal?: number | null
}

export interface SaleInput extends SaleFeesFields {
  /** Where it sold — eBay, Facebook Marketplace, a walk-in sale, etc. Free text, user-managed list. */
  channel: string
  paymentMethod: PaymentMethod
  lines: SaleLineInput[]
}

/** A sale line as recorded — snapshots the product's name/SKU/cost so history
 * reads correctly even if the product is later renamed or deleted. */
export interface SaleLine {
  id: string
  saleId: string
  productId: string
  sku: string
  name: string
  quantity: number
  unitPrice: number
  unitCost: number
  lineTotal: number
  lineProfit: number
}

/** A sale as recorded — same fee fields as `SaleFeesFields`, but always
 * concretely present (a repository resolves every optional input down to a
 * real number/choice before persisting) rather than possibly-absent. Kept
 * optional here too, though, so older records synced before these fields
 * existed — and hand-built fixtures in tests — stay valid without a
 * migration; `domain/sales.ts`'s helpers treat a missing value as 0. */
export interface Sale extends SaleFeesFields {
  id: string
  channel: string
  paymentMethod: PaymentMethod
  subtotal: number
  totalCost: number
  profit: number
  createdAt: string
  /** Set once this sale has been edited after the fact — absent otherwise. */
  updatedAt?: string
  lines: SaleLine[]
}

// --- Returns, refunds, replacements and goodwill gestures -----------------
//
// A single case can be any combination of these four actions at once (e.g. a
// customer returns one item for a refund AND gets a goodwill voucher for the
// inconvenience). Every field on ReturnCaseInput is optional — a case can be
// as small as "gave a voucher, no item involved" or as complete as a full
// refund plus a restocked item plus a note.

export type ReturnAction = 'refund' | 'return' | 'replacement' | 'goodwill'

export const RETURN_ACTIONS: ReturnAction[] = ['refund', 'return', 'replacement', 'goodwill']

export const RETURN_ACTION_LABELS: Record<ReturnAction, string> = {
  refund: 'Refund',
  return: 'Return',
  replacement: 'Replacement',
  goodwill: 'Goodwill gesture',
}

/** What happens to a returned item once it's back in hand. */
export type StockDisposition = 'restock' | 'writeoff'

export const STOCK_DISPOSITIONS: StockDisposition[] = ['restock', 'writeoff']

export const STOCK_DISPOSITION_LABELS: Record<StockDisposition, string> = {
  restock: 'Back into stock',
  writeoff: 'Written off',
}

/** One physical item coming back from a customer — the item itself for a
 * plain return, or the "old" side of a replacement. */
export interface ReturnLineInput {
  productId: string
  quantity: number
  disposition: StockDisposition
}

/** A returned line as recorded — snapshots sku/name/cost so history reads
 * correctly even if the product is later renamed or deleted, the same way
 * SaleLine does. */
export interface ReturnLine {
  id: string
  returnId: string
  productId: string
  sku: string
  name: string
  quantity: number
  disposition: StockDisposition
  unitCost: number
}

/** One item going back out to the customer — the "new" side of a
 * replacement. Decrements stock exactly like a sale line, but at no charge. */
export interface ReplacementLineInput {
  productId: string
  quantity: number
}

export interface ReplacementLine {
  id: string
  returnId: string
  productId: string
  sku: string
  name: string
  quantity: number
  unitCost: number
}

export interface ReturnCaseInput {
  /** Links back to the original till sale, when there was one and it's known. */
  saleId?: string
  channel?: string
  /** Free text — name, email, order number, whatever identifies who this is for. */
  customerRef?: string
  reason?: string
  notes?: string
  /** Any subset of the four actions, including none (e.g. a note-only record). */
  actions: ReturnAction[]
  refundAmount?: number
  refundMethod?: PaymentMethod
  /** Free text — "Voucher", "Store credit", "Discount code", etc. */
  goodwillType?: string
  goodwillValue?: number
  returnLines?: ReturnLineInput[]
  replacementLines?: ReplacementLineInput[]
}

export interface ReturnCase {
  id: string
  saleId: string
  channel: string
  customerRef: string
  reason: string
  notes: string
  actions: ReturnAction[]
  refundAmount: number
  refundMethod: PaymentMethod | null
  goodwillType: string
  goodwillValue: number
  returnLines: ReturnLine[]
  replacementLines: ReplacementLine[]
  createdAt: string
  /** Set once this case has been edited after the fact — absent otherwise. */
  updatedAt?: string
}

// --- Account settings: personal/employee details ---------------------------
//
// A password is handled separately, straight through Supabase Auth
// (`client.auth.updateUser({ password })`), the same way the existing
// "forgot password" flow already does — it's a personal security credential,
// not business data, so it takes effect immediately for anyone regardless of
// role, with no approval step.
//
// Everything below IS business data about who someone is, so it follows the
// same manager/employee split as everything else in `domain/permissions.ts`:
// a manager's own edits apply immediately; an employee's edits are held as a
// pending request until a manager approves or rejects them.

/** Personal/employee details, editable from Account settings. */
export interface Profile {
  fullName: string
  /** ISO date (YYYY-MM-DD), or '' if not set. */
  birthday: string
  address: string
  employeeNumber: string
  /** A display/login-adjacent handle, separate from the email used to sign in. */
  username: string
  updatedAt: string
}

/** Fields a user supplies when editing their own profile. */
export type ProfileDraft = Omit<Profile, 'updatedAt'>

export const EMPTY_PROFILE_DRAFT: ProfileDraft = {
  fullName: '',
  birthday: '',
  address: '',
  employeeNumber: '',
  username: '',
}

/** What happened after submitting a profile edit — applied immediately (a
 * manager editing their own details), or held for manager approval (an
 * employee editing theirs). */
export type ProfileUpdateOutcome = { status: 'applied'; profile: Profile } | { status: 'pending' }

export type ProfileChangeStatus = 'pending' | 'approved' | 'rejected'

/** An employee's proposed profile edit, awaiting a manager's decision. */
export interface ProfileChangeRequest {
  id: string
  /** Who asked for the change — "You" is inferred client-side, same as TeamMember. */
  memberEmail: string
  proposed: ProfileDraft
  status: ProfileChangeStatus
  requestedAt: string
}
