import type { AppliedMovement } from '../domain/movements'
import type {
  ActivityAction,
  ActivityEntityType,
  ActivityLogEntry,
  MovementInput,
  Product,
  ProductDraft,
  Profile,
  ProfileChangeRequest,
  ProfileDraft,
  ProfileUpdateOutcome,
  Result,
  ReturnCase,
  ReturnCaseInput,
  Sale,
  SaleInput,
  StockMovement,
} from '../domain/types'
import type { QuickCode } from '../domain/quickCodes'
import type { LabelPreset, LabelTemplate } from '../printing/labelTemplate'
import type {
  Supplier,
  SupplierDraft,
  SupplierProduct,
  SupplierProductDraft,
  PurchaseOrder,
  PurchaseOrderInput,
} from '../domain/suppliers'

/**
 * The label logo, label template, saved label presets, sale channels and
 * quick-reference codes — shared account-wide (not per-person, unlike
 * Profile), so whoever last saved a change is what everyone on the account
 * sees next time they open the app. Any field left out of a
 * `setAccountSettings` patch is left as-is.
 */
export interface AccountSettingsSync {
  logoDataUrl?: string
  labelTemplate?: LabelTemplate
  saleChannels?: string[]
  labelPresets?: LabelPreset[]
  quickCodes?: QuickCode[]
  /** Manager-curated product category list — see `Settings.productCategories`. */
  productCategories?: string[]
}

/**
 * A manager can do everything. An employee can scan, count and sell stock,
 * but can't see what anything costs or what the business makes on it, can't
 * delete a product or change its cost/price, can't override a sale price,
 * can't approve a stocktake recount, and can't process a refund, goodwill
 * gesture, or write-off — those need a manager.
 *
 * Local (offline demo) mode has no concept of more than one person, so it
 * always reports 'manager'. Roles only mean something once the app is
 * talking to Supabase, where a real second login can exist.
 */
export type Role = 'manager' | 'employee'

export interface TeamMember {
  /** The membership row id — pass this to removeTeamMember. */
  id: string
  /** Email captured at invite time (or "you" is inferred client-side for your own row). */
  email: string
  role: Role
  status: 'active' | 'pending'
  /** True when this row is the person currently signed in. */
  isYou: boolean
  /**
   * Only meaningful on the row `inviteEmployee` just returned, never on rows
   * from `listTeam`. `true` once a sign-in email has actually been sent to a
   * brand-new invite so they can get started without being told to visit the
   * site themselves; `false` if sending it failed (they were still added to
   * the team — just tell them to sign in manually); `undefined` when no
   * email was attempted at all (e.g. they already had a StockFlow login
   * elsewhere and were linked in immediately).
   */
  emailSent?: boolean
}

export interface InventoryRepository {
  /** Shown in the UI so it is obvious which backend is live. */
  readonly kind: 'local' | 'supabase'
  /** The signed-in person's role on this account. Always 'manager' locally. */
  readonly role: Role
  listProducts(): Promise<Product[]>
  listMovements(): Promise<StockMovement[]>
  createProduct(draft: ProductDraft): Promise<Result<Product>>
  updateProduct(id: string, draft: ProductDraft): Promise<Result<Product>>
  deleteProduct(id: string): Promise<Result<true>>
  recordMovement(productId: string, input: MovementInput): Promise<Result<AppliedMovement>>
  listSales(): Promise<Sale[]>
  /** Decrements stock for every line and records the sale as one atomic unit. */
  recordSale(input: SaleInput): Promise<Result<Sale>>
  /**
   * Manager-only. Fully replaces a past sale's items, quantities and prices.
   * Atomically reverses the original sale's stock effect and reapplies the
   * edited one — so the product catalogue always reflects the *current*
   * version of the sale, no matter how many times it's been edited.
   */
  updateSale(id: string, input: SaleInput): Promise<Result<Sale>>
  listReturns(): Promise<ReturnCase[]>
  /**
   * Applies the stock effects of a return case (restocking, writing off,
   * handing out a replacement) and records the case as one atomic unit.
   */
  recordReturn(input: ReturnCaseInput): Promise<Result<ReturnCase>>
  /**
   * Manager-only. Fully replaces a past return case — items, quantities,
   * dispositions, replacements, refund/goodwill — atomically reversing the
   * original case's stock effect and reapplying the edited one.
   */
  updateReturn(id: string, input: ReturnCaseInput): Promise<Result<ReturnCase>>
  /** The account owner plus every invited employee, active or still pending. */
  listTeam(): Promise<TeamMember[]>
  /** Manager-only. Invites (or re-links) an employee by email. */
  inviteEmployee(email: string): Promise<Result<TeamMember>>
  /** Manager-only. Revokes access without deleting their activity history. */
  removeTeamMember(membershipId: string): Promise<Result<true>>
  /** The signed-in person's own profile — empty fields until they've set anything. */
  getProfile(): Promise<Profile>
  /**
   * Submits an edit to your own profile. A manager's edit takes effect
   * immediately; an employee's edit is held pending a manager's approval —
   * see `ProfileUpdateOutcome`.
   */
  updateProfile(draft: ProfileDraft): Promise<Result<ProfileUpdateOutcome>>
  /** Manager-only. Every employee profile edit awaiting a decision. */
  listPendingProfileChanges(): Promise<ProfileChangeRequest[]>
  /** Manager-only. Applies a pending edit to that employee's profile. */
  approveProfileChange(requestId: string): Promise<Result<true>>
  /** Manager-only. Discards a pending edit without applying it. */
  rejectProfileChange(requestId: string): Promise<Result<true>>
  // =========================================================================
  // SUPPLIER & PURCHASE ORDER MANAGEMENT (manager-only)
  // =========================================================================
  /** Manager-only. All suppliers for this account. */
  listSuppliers(): Promise<Supplier[]>
  /** Manager-only. Creates a new supplier. */
  createSupplier(draft: SupplierDraft): Promise<Result<Supplier>>
  /** Manager-only. Updates supplier details. */
  updateSupplier(id: string, draft: SupplierDraft): Promise<Result<Supplier>>
  /** Manager-only. Deletes a supplier (supplier product links are removed). */
  deleteSupplier(id: string): Promise<Result<true>>
  /** Manager-only. Links a product to a supplier with pricing. */
  linkSupplierProduct(draft: SupplierProductDraft): Promise<Result<SupplierProduct>>
  /** Manager-only. Updates the pricing/minimum order for a supplier-product link. */
  updateSupplierProduct(id: string, draft: SupplierProductDraft): Promise<Result<SupplierProduct>>
  /** Manager-only. Removes the link between a supplier and product. */
  unlinkSupplierProduct(id: string): Promise<Result<true>>
  /** Manager-only. All supplier-product links, for finding cheapest suppliers. */
  listSupplierProducts(): Promise<SupplierProduct[]>
  /** Manager-only. All purchase orders (across all statuses). */
  listPurchaseOrders(): Promise<PurchaseOrder[]>
  /** Manager-only. Creates a new PO in draft status. */
  createPurchaseOrder(input: PurchaseOrderInput): Promise<Result<PurchaseOrder>>
  /** Manager-only. Sends a draft PO to the supplier (changes status to 'sent'). */
  sendPurchaseOrder(id: string): Promise<Result<PurchaseOrder>>
  /** Manager-only. Marks a sent PO as confirmed by the supplier. */
  confirmPurchaseOrder(id: string): Promise<Result<PurchaseOrder>>
  /** Manager-only. Receives a PO and adds stock. */
  receivePurchaseOrder(id: string, lineQuantities: Map<string, number>): Promise<Result<PurchaseOrder>>
  /** Manager-only. Cancels a PO. */
  cancelPurchaseOrder(id: string): Promise<Result<PurchaseOrder>>
  /**
   * The account's synced label logo/template/sale channels, if anyone on
   * this account has ever saved any — `null` in local mode (there's no
   * account to sync to; settings just live in this browser) and when
   * nothing has been saved to this account yet.
   */
  getAccountSettings(): Promise<AccountSettingsSync | null>
  /** Saves (patches) the account's synced settings — see `AccountSettingsSync`. */
  setAccountSettings(patch: AccountSettingsSync): Promise<Result<true>>
  // =========================================================================
  // SHARED ACTIVITY LOG
  // =========================================================================
  /** Every logged change, newest first — product add/edit/delete, sale/return
   * edits, and team/membership changes. Manager-only: gated in the UI (the
   * Activity tab in HistoryScreen doesn't render for an employee) and, for
   * the Supabase backend, in RLS too (`activity_log_select_own` also checks
   * `current_role() = 'manager'` — see `activity_log_migration.sql`), so a
   * non-manager can't read it even by calling the API directly. See
   * `ActivityLogEntry`. */
  listActivity(): Promise<ActivityLogEntry[]>
  /**
   * Records one activity-log entry. In practice this is called internally by
   * `createProduct`/`updateProduct`/`deleteProduct`, `updateSale`,
   * `updateReturn`, `inviteEmployee` and `removeTeamMember` right after their
   * write succeeds — it is on the interface (rather than a private
   * implementation detail) so both backends share one entry point for it.
   * Deliberately best-effort and fire-and-forget from the caller's point of
   * view: a failure to log here must never block or roll back the write that
   * already succeeded, the same reasoning the invite-email send follows.
   */
  logActivity(
    entityType: ActivityEntityType,
    action: ActivityAction,
    entityId: string | null,
    entityLabel: string,
    detail: string,
  ): Promise<void>
}

export const NOT_FOUND = 'Product not found.'
export const DUPLICATE_BARCODE = 'That barcode is already used by another product.'
export const DUPLICATE_SKU = 'That SKU is already used by another product.'
export const EMPTY_SALE = 'Add at least one item before checking out.'
export const EMPTY_RETURN = 'Add at least one action, item, refund, or note before saving.'
export const SALE_NOT_FOUND = 'Sale not found.'
export const RETURN_NOT_FOUND = 'Return not found.'
export const TEAM_NOT_SUPPORTED = 'Team accounts need the Supabase backend — this device is running the offline demo store.'
export const NO_PENDING_CHANGE = "That change request isn't pending any more."
