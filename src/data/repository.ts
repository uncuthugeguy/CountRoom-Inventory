import type { AppliedMovement } from '../domain/movements'
import type {
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
import type { LabelPreset, LabelTemplate } from '../printing/labelTemplate'

/**
 * The label logo, label template, saved label presets and sale channels —
 * shared account-wide (not per-person, unlike Profile), so whoever last
 * saved a change is what everyone on the account sees next time they open
 * the app. Any field left out of a `setAccountSettings` patch is left as-is.
 */
export interface AccountSettingsSync {
  logoDataUrl?: string
  labelTemplate?: LabelTemplate
  saleChannels?: string[]
  labelPresets?: LabelPreset[]
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
  listReturns(): Promise<ReturnCase[]>
  /**
   * Applies the stock effects of a return case (restocking, writing off,
   * handing out a replacement) and records the case as one atomic unit.
   */
  recordReturn(input: ReturnCaseInput): Promise<Result<ReturnCase>>
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
  /**
   * The account's synced label logo/template/sale channels, if anyone on
   * this account has ever saved any — `null` in local mode (there's no
   * account to sync to; settings just live in this browser) and when
   * nothing has been saved to this account yet.
   */
  getAccountSettings(): Promise<AccountSettingsSync | null>
  /** Saves (patches) the account's synced settings — see `AccountSettingsSync`. */
  setAccountSettings(patch: AccountSettingsSync): Promise<Result<true>>
}

export const NOT_FOUND = 'Product not found.'
export const DUPLICATE_BARCODE = 'That barcode is already used by another product.'
export const DUPLICATE_SKU = 'That SKU is already used by another product.'
export const EMPTY_SALE = 'Add at least one item before checking out.'
export const EMPTY_RETURN = 'Add at least one action, item, refund, or note before saving.'
export const TEAM_NOT_SUPPORTED = 'Team accounts need the Supabase backend — this device is running the offline demo store.'
export const NO_PENDING_CHANGE = "That change request isn't pending any more."
