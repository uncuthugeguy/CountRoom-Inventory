import { applyMovement } from '../domain/movements'
import { validateDraft } from '../domain/products'
import { validateReturnCaseInput } from '../domain/returns'
import { saleFeeTotal } from '../domain/sales'
import type { AppliedMovement } from '../domain/movements'
import type {
  MovementInput,
  Product,
  ProductDraft,
  Profile,
  ProfileChangeRequest,
  ProfileDraft,
  ProfileUpdateOutcome,
  ReplacementLine,
  Result,
  ReturnCase,
  ReturnCaseInput,
  ReturnLine,
  Sale,
  SaleInput,
  SaleLine,
  StockMovement,
} from '../domain/types'
import { EMPTY_PROFILE_DRAFT } from '../domain/types'
import { DEMO_PRODUCTS } from './demoSeed'
import {
  DUPLICATE_BARCODE,
  DUPLICATE_SKU,
  EMPTY_SALE,
  NOT_FOUND,
  RETURN_NOT_FOUND,
  SALE_NOT_FOUND,
  TEAM_NOT_SUPPORTED,
  type InventoryRepository,
  type TeamMember,
} from './repository'

export const STORAGE_KEY = 'stockflow.v1'

interface Snapshot {
  products: Product[]
  movements: StockMovement[]
  sales: Sale[]
  returns: ReturnCase[]
  profile: Profile
}

export interface LocalRepositoryOptions {
  /** Populate an empty store with the demo catalogue. Defaults to true. */
  seed?: boolean
  storage?: Storage
}

const emptyProfile = (): Profile => ({ ...EMPTY_PROFILE_DRAFT, updatedAt: new Date().toISOString() })

const empty = (): Snapshot => ({ products: [], movements: [], sales: [], returns: [], profile: emptyProfile() })

function read(storage: Storage): Snapshot | null {
  const raw = storage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<Snapshot>
    if (!Array.isArray(parsed.products) || !Array.isArray(parsed.movements)) return empty()
    // Older snapshots predate sales, returns and profile tracking entirely.
    const sales = Array.isArray(parsed.sales) ? parsed.sales : []
    const returns = Array.isArray(parsed.returns) ? parsed.returns : []
    const profile = parsed.profile && typeof parsed.profile === 'object' ? { ...emptyProfile(), ...parsed.profile } : emptyProfile()
    return { products: parsed.products, movements: parsed.movements, sales, returns, profile }
  } catch {
    // Corrupt or hand-edited storage: start clean rather than crash on boot.
    return empty()
  }
}

const newId = (): string =>
  typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`

/**
 * Offline-first repository backed by localStorage. This is the default backend
 * so the app runs with no credentials at all.
 */
export function createLocalRepository(
  options: LocalRepositoryOptions = {},
): InventoryRepository {
  const storage = options.storage ?? localStorage
  const seed = options.seed ?? true

  let state =
    read(storage) ??
    (seed ? { products: [...DEMO_PRODUCTS], movements: [], sales: [], returns: [], profile: emptyProfile() } : empty())

  const persist = () => storage.setItem(STORAGE_KEY, JSON.stringify(state))
  if (!storage.getItem(STORAGE_KEY)) persist()

  // A blank barcode never conflicts — most products won't have one at all.
  const barcodeTaken = (barcode: string, exceptId?: string) =>
    barcode !== '' && state.products.some((p) => p.barcode === barcode && p.id !== exceptId)

  // Mirrors the `products_user_sku_unique` constraint in the Supabase schema,
  // so a duplicate SKU is rejected the same way on both backends.
  const skuTaken = (sku: string, exceptId?: string) =>
    state.products.some((p) => p.sku === sku && p.id !== exceptId)

  return {
    kind: 'local',
    // No second real login exists in offline demo mode — see Role's doc
    // comment in repository.ts for why this is always 'manager' here.
    role: 'manager',

    async listProducts() {
      return state.products.map((p) => ({ ...p }))
    },

    async listMovements() {
      return state.movements.map((m) => ({ ...m }))
    },

    async createProduct(draft: ProductDraft): Promise<Result<Product>> {
      const validated = validateDraft(draft)
      if (!validated.ok) return validated
      if (barcodeTaken(validated.value.barcode)) {
        return { ok: false, error: DUPLICATE_BARCODE }
      }
      if (skuTaken(validated.value.sku)) {
        return { ok: false, error: DUPLICATE_SKU }
      }

      const at = new Date().toISOString()
      const product: Product = { ...validated.value, id: newId(), createdAt: at, updatedAt: at }
      state = { ...state, products: [...state.products, product] }
      persist()
      return { ok: true, value: { ...product } }
    },

    async updateProduct(id: string, draft: ProductDraft): Promise<Result<Product>> {
      const existing = state.products.find((p) => p.id === id)
      if (!existing) return { ok: false, error: NOT_FOUND }

      const validated = validateDraft(draft)
      if (!validated.ok) return validated
      if (barcodeTaken(validated.value.barcode, id)) {
        return { ok: false, error: DUPLICATE_BARCODE }
      }
      if (skuTaken(validated.value.sku, id)) {
        return { ok: false, error: DUPLICATE_SKU }
      }

      const updated: Product = {
        ...existing,
        ...validated.value,
        updatedAt: new Date().toISOString(),
      }
      state = {
        ...state,
        products: state.products.map((p) => (p.id === id ? updated : p)),
      }
      persist()
      return { ok: true, value: { ...updated } }
    },

    async deleteProduct(id: string): Promise<Result<true>> {
      // Movements are kept: the audit trail outlives the catalogue entry.
      state = { ...state, products: state.products.filter((p) => p.id !== id) }
      persist()
      return { ok: true, value: true }
    },

    async recordMovement(
      productId: string,
      input: MovementInput,
    ): Promise<Result<AppliedMovement>> {
      const existing = state.products.find((p) => p.id === productId)
      if (!existing) return { ok: false, error: NOT_FOUND }

      const applied = applyMovement(existing, input, {
        id: newId(),
        at: new Date().toISOString(),
      })
      if (!applied.ok) return applied

      state = {
        ...state,
        products: state.products.map((p) => (p.id === productId ? applied.value.product : p)),
        // Newest first: the history view and CSV export read in this order.
        movements: [applied.value.movement, ...state.movements],
      }
      persist()
      return applied
    },

    async listSales() {
      return state.sales.map((s) => ({ ...s, lines: s.lines.map((l) => ({ ...l })) }))
    },

    async recordSale(input: SaleInput): Promise<Result<Sale>> {
      if (input.lines.length === 0) return { ok: false, error: EMPTY_SALE }

      // Every marketplace fee is optional on the input — most sales (cash,
      // walk-in) have none — so every amount defaults to 0 and delivery
      // defaults to seller-paid, exactly like the Supabase-backed
      // checkout_sale() function does for the cloud repository.
      const buyerProtectionFee = input.buyerProtectionFee ?? 0
      const deliveryCost = input.deliveryCost ?? 0
      const deliveryPaidBy = input.deliveryPaidBy ?? 'seller'
      const vat = input.vat ?? 0
      const advertisingCost = input.advertisingCost ?? 0
      const orderTotal = input.orderTotal ?? null
      const feeTotal = saleFeeTotal({ buyerProtectionFee, deliveryCost, deliveryPaidBy, vat, advertisingCost })

      const at = new Date().toISOString()
      const saleId = newId()
      const nextProducts = [...state.products]
      const newMovements: StockMovement[] = []
      const saleLines: SaleLine[] = []

      for (const line of input.lines) {
        const idx = nextProducts.findIndex((p) => p.id === line.productId)
        if (idx === -1) return { ok: false, error: NOT_FOUND }
        const product = nextProducts[idx]

        const applied = applyMovement(
          product,
          {
            type: 'out',
            quantity: line.quantity,
            reason: `Sale — ${input.channel || 'Unspecified'}`,
          },
          { id: newId(), at },
        )
        if (!applied.ok) return applied

        nextProducts[idx] = applied.value.product
        newMovements.push(applied.value.movement)

        const lineTotal = line.unitPrice * line.quantity
        const lineCost = product.cost * line.quantity
        saleLines.push({
          id: newId(),
          saleId,
          productId: product.id,
          sku: product.sku,
          name: product.name,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          unitCost: product.cost,
          lineTotal,
          lineProfit: lineTotal - lineCost,
        })
      }

      const sale: Sale = {
        id: saleId,
        channel: input.channel,
        paymentMethod: input.paymentMethod,
        subtotal: saleLines.reduce((sum, l) => sum + l.lineTotal, 0),
        totalCost: saleLines.reduce((sum, l) => sum + l.unitCost * l.quantity, 0),
        buyerProtectionFee,
        deliveryCost,
        deliveryPaidBy,
        vat,
        advertisingCost,
        orderTotal,
        // Net of the marketplace fees above, not just item price minus item
        // cost — the whole point of tracking them is that they come out of
        // what you actually keep.
        profit: saleLines.reduce((sum, l) => sum + l.lineProfit, 0) - feeTotal,
        createdAt: at,
        lines: saleLines,
      }

      state = {
        ...state,
        products: nextProducts,
        movements: [...newMovements, ...state.movements],
        sales: [sale, ...state.sales],
      }
      persist()
      return { ok: true, value: sale }
    },

    async updateSale(id: string, input: SaleInput): Promise<Result<Sale>> {
      const existing = state.sales.find((s) => s.id === id)
      if (!existing) return { ok: false, error: SALE_NOT_FOUND }
      if (input.lines.length === 0) return { ok: false, error: EMPTY_SALE }

      const buyerProtectionFee = input.buyerProtectionFee ?? 0
      const deliveryCost = input.deliveryCost ?? 0
      const deliveryPaidBy = input.deliveryPaidBy ?? 'seller'
      const vat = input.vat ?? 0
      const advertisingCost = input.advertisingCost ?? 0
      const orderTotal = input.orderTotal ?? null
      const feeTotal = saleFeeTotal({ buyerProtectionFee, deliveryCost, deliveryPaidBy, vat, advertisingCost })

      const at = new Date().toISOString()
      const nextProducts = [...state.products]
      const newMovements: StockMovement[] = []

      // Reverse the stock effect of every existing line first, so the
      // reapply step below always has an accurate picture of what's on
      // hand — mirrors edit_sale() in supabase/schema.sql exactly. A
      // product that's since been deleted just has its old line dropped.
      for (const line of existing.lines) {
        const idx = nextProducts.findIndex((p) => p.id === line.productId)
        if (idx === -1) continue
        const applied = applyMovement(
          nextProducts[idx],
          { type: 'in', quantity: line.quantity, reason: 'Sale edit — reversal' },
          { id: newId(), at },
        )
        if (!applied.ok) return applied
        nextProducts[idx] = applied.value.product
        newMovements.push(applied.value.movement)
      }

      const saleLines: SaleLine[] = []
      for (const line of input.lines) {
        const idx = nextProducts.findIndex((p) => p.id === line.productId)
        if (idx === -1) return { ok: false, error: NOT_FOUND }
        const product = nextProducts[idx]

        const applied = applyMovement(
          product,
          { type: 'out', quantity: line.quantity, reason: `Sale edit — ${input.channel || 'Unspecified'}` },
          { id: newId(), at },
        )
        if (!applied.ok) return applied
        nextProducts[idx] = applied.value.product
        newMovements.push(applied.value.movement)

        const lineTotal = line.unitPrice * line.quantity
        const lineCost = product.cost * line.quantity
        saleLines.push({
          id: newId(),
          saleId: id,
          productId: product.id,
          sku: product.sku,
          name: product.name,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          unitCost: product.cost,
          lineTotal,
          lineProfit: lineTotal - lineCost,
        })
      }

      const updated: Sale = {
        ...existing,
        channel: input.channel,
        paymentMethod: input.paymentMethod,
        subtotal: saleLines.reduce((sum, l) => sum + l.lineTotal, 0),
        totalCost: saleLines.reduce((sum, l) => sum + l.unitCost * l.quantity, 0),
        buyerProtectionFee,
        deliveryCost,
        deliveryPaidBy,
        vat,
        advertisingCost,
        orderTotal,
        profit: saleLines.reduce((sum, l) => sum + l.lineProfit, 0) - feeTotal,
        updatedAt: at,
        lines: saleLines,
      }

      state = {
        ...state,
        products: nextProducts,
        movements: [...newMovements, ...state.movements],
        sales: state.sales.map((s) => (s.id === id ? updated : s)),
      }
      persist()
      return { ok: true, value: updated }
    },

    async listReturns() {
      return state.returns.map((r) => ({
        ...r,
        actions: [...r.actions],
        returnLines: r.returnLines.map((l) => ({ ...l })),
        replacementLines: r.replacementLines.map((l) => ({ ...l })),
      }))
    },

    async recordReturn(input: ReturnCaseInput): Promise<Result<ReturnCase>> {
      const validated = validateReturnCaseInput(input)
      if (!validated.ok) return validated

      const at = new Date().toISOString()
      const returnId = newId()
      const nextProducts = [...state.products]
      const newMovements: StockMovement[] = []
      const returnLines: ReturnLine[] = []
      const replacementLines: ReplacementLine[] = []
      const noted = input.reason?.trim() ? `: ${input.reason.trim()}` : ''

      for (const line of input.returnLines ?? []) {
        const idx = nextProducts.findIndex((p) => p.id === line.productId)
        if (idx === -1) return { ok: false, error: NOT_FOUND }
        const product = nextProducts[idx]

        // Only a restock changes the quantity on hand — a write-off leaves
        // the item out of sellable stock, so it gets no movement of its own;
        // its cost is captured on the return line instead, for loss reporting.
        if (line.disposition === 'restock') {
          const applied = applyMovement(
            product,
            { type: 'in', quantity: line.quantity, reason: `Return — restock${noted}` },
            { id: newId(), at },
          )
          if (!applied.ok) return applied
          nextProducts[idx] = applied.value.product
          newMovements.push(applied.value.movement)
        }

        returnLines.push({
          id: newId(),
          returnId,
          productId: product.id,
          sku: product.sku,
          name: product.name,
          quantity: line.quantity,
          disposition: line.disposition,
          unitCost: product.cost,
        })
      }

      for (const line of input.replacementLines ?? []) {
        const idx = nextProducts.findIndex((p) => p.id === line.productId)
        if (idx === -1) return { ok: false, error: NOT_FOUND }
        const product = nextProducts[idx]

        const applied = applyMovement(
          product,
          { type: 'out', quantity: line.quantity, reason: `Return — replacement${noted}` },
          { id: newId(), at },
        )
        if (!applied.ok) return applied
        nextProducts[idx] = applied.value.product
        newMovements.push(applied.value.movement)

        replacementLines.push({
          id: newId(),
          returnId,
          productId: product.id,
          sku: product.sku,
          name: product.name,
          quantity: line.quantity,
          unitCost: product.cost,
        })
      }

      const actions = input.actions ?? []
      const returnCase: ReturnCase = {
        id: returnId,
        saleId: input.saleId ?? '',
        channel: input.channel ?? '',
        customerRef: input.customerRef ?? '',
        reason: input.reason ?? '',
        notes: input.notes ?? '',
        actions,
        refundAmount: actions.includes('refund') ? (input.refundAmount ?? 0) : 0,
        refundMethod: actions.includes('refund') ? (input.refundMethod ?? null) : null,
        goodwillType: actions.includes('goodwill') ? (input.goodwillType ?? '') : '',
        goodwillValue: actions.includes('goodwill') ? (input.goodwillValue ?? 0) : 0,
        returnLines,
        replacementLines,
        createdAt: at,
      }

      state = {
        ...state,
        products: nextProducts,
        movements: [...newMovements, ...state.movements],
        returns: [returnCase, ...state.returns],
      }
      persist()
      return { ok: true, value: returnCase }
    },

    async updateReturn(id: string, input: ReturnCaseInput): Promise<Result<ReturnCase>> {
      const existing = state.returns.find((r) => r.id === id)
      if (!existing) return { ok: false, error: RETURN_NOT_FOUND }

      const validated = validateReturnCaseInput(input)
      if (!validated.ok) return validated

      const at = new Date().toISOString()
      const nextProducts = [...state.products]
      const newMovements: StockMovement[] = []
      const noted = input.reason?.trim() ? `: ${input.reason.trim()}` : ''

      // Reverse every existing return line's stock effect first — mirrors
      // edit_return() in supabase/schema.sql. A restocked line put stock
      // back on the shelf, so un-doing it has to take that stock back out;
      // if some of it has since been sold, editing is blocked rather than
      // letting stock go negative.
      for (const line of existing.returnLines) {
        if (line.disposition !== 'restock') continue
        const idx = nextProducts.findIndex((p) => p.id === line.productId)
        if (idx === -1) continue
        const product = nextProducts[idx]
        if (product.quantity < line.quantity) {
          return {
            ok: false,
            error: `Cannot edit — ${line.quantity - product.quantity} of the restocked ${line.name} has already been sold.`,
          }
        }
        const applied = applyMovement(
          product,
          { type: 'out', quantity: line.quantity, reason: 'Return edit — reversal' },
          { id: newId(), at },
        )
        if (!applied.ok) return applied
        nextProducts[idx] = applied.value.product
        newMovements.push(applied.value.movement)
      }

      // Reverse every existing replacement line's stock effect (give back
      // the item that was handed to the customer at no charge).
      for (const line of existing.replacementLines) {
        const idx = nextProducts.findIndex((p) => p.id === line.productId)
        if (idx === -1) continue
        const applied = applyMovement(
          nextProducts[idx],
          { type: 'in', quantity: line.quantity, reason: 'Return edit — reversal' },
          { id: newId(), at },
        )
        if (!applied.ok) return applied
        nextProducts[idx] = applied.value.product
        newMovements.push(applied.value.movement)
      }

      const returnLines: ReturnLine[] = []
      for (const line of input.returnLines ?? []) {
        const idx = nextProducts.findIndex((p) => p.id === line.productId)
        if (idx === -1) return { ok: false, error: NOT_FOUND }
        const product = nextProducts[idx]

        if (line.disposition === 'restock') {
          const applied = applyMovement(
            product,
            { type: 'in', quantity: line.quantity, reason: `Return edit — restock${noted}` },
            { id: newId(), at },
          )
          if (!applied.ok) return applied
          nextProducts[idx] = applied.value.product
          newMovements.push(applied.value.movement)
        }

        returnLines.push({
          id: newId(),
          returnId: id,
          productId: product.id,
          sku: product.sku,
          name: product.name,
          quantity: line.quantity,
          disposition: line.disposition,
          unitCost: product.cost,
        })
      }

      const replacementLines: ReplacementLine[] = []
      for (const line of input.replacementLines ?? []) {
        const idx = nextProducts.findIndex((p) => p.id === line.productId)
        if (idx === -1) return { ok: false, error: NOT_FOUND }
        const product = nextProducts[idx]

        const applied = applyMovement(
          product,
          { type: 'out', quantity: line.quantity, reason: `Return edit — replacement${noted}` },
          { id: newId(), at },
        )
        if (!applied.ok) return applied
        nextProducts[idx] = applied.value.product
        newMovements.push(applied.value.movement)

        replacementLines.push({
          id: newId(),
          returnId: id,
          productId: product.id,
          sku: product.sku,
          name: product.name,
          quantity: line.quantity,
          unitCost: product.cost,
        })
      }

      const actions = input.actions ?? []
      const updated: ReturnCase = {
        ...existing,
        saleId: input.saleId ?? '',
        channel: input.channel ?? '',
        customerRef: input.customerRef ?? '',
        reason: input.reason ?? '',
        notes: input.notes ?? '',
        actions,
        refundAmount: actions.includes('refund') ? (input.refundAmount ?? 0) : 0,
        refundMethod: actions.includes('refund') ? (input.refundMethod ?? null) : null,
        goodwillType: actions.includes('goodwill') ? (input.goodwillType ?? '') : '',
        goodwillValue: actions.includes('goodwill') ? (input.goodwillValue ?? 0) : 0,
        returnLines,
        replacementLines,
        updatedAt: at,
      }

      state = {
        ...state,
        products: nextProducts,
        movements: [...newMovements, ...state.movements],
        returns: state.returns.map((r) => (r.id === id ? updated : r)),
      }
      persist()
      return { ok: true, value: updated }
    },

    async listTeam(): Promise<TeamMember[]> {
      // One person, one role — nothing to list. See the `role` comment above.
      return [{ id: 'you', email: 'you', role: 'manager', status: 'active', isYou: true }]
    },

    async inviteEmployee(): Promise<Result<TeamMember>> {
      return { ok: false, error: TEAM_NOT_SUPPORTED }
    },

    async removeTeamMember(): Promise<Result<true>> {
      return { ok: false, error: TEAM_NOT_SUPPORTED }
    },

    async getProfile(): Promise<Profile> {
      return { ...state.profile }
    },

    async updateProfile(draft: ProfileDraft): Promise<Result<ProfileUpdateOutcome>> {
      // Solo local mode is always 'manager' — an edit here always applies
      // immediately, there's no one else around to approve it.
      const profile: Profile = { ...draft, updatedAt: new Date().toISOString() }
      state = { ...state, profile }
      persist()
      return { ok: true, value: { status: 'applied', profile } }
    },

    async listPendingProfileChanges(): Promise<ProfileChangeRequest[]> {
      // Nothing is ever held pending locally — see updateProfile above.
      return []
    },

    async approveProfileChange(): Promise<Result<true>> {
      return { ok: false, error: TEAM_NOT_SUPPORTED }
    },

    async rejectProfileChange(): Promise<Result<true>> {
      return { ok: false, error: TEAM_NOT_SUPPORTED }
    },

    async getAccountSettings() {
      // No account to sync to in offline demo mode — settings already live
      // in this browser's own storage, which is the whole of the model here.
      return null
    },

    async setAccountSettings(): Promise<Result<true>> {
      return { ok: false, error: TEAM_NOT_SUPPORTED }
    },
  }
}
