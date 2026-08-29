import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppliedMovement } from '../domain/movements'
import type {
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
import type { AccountSettingsSync, InventoryRepository, Role, TeamMember } from '../data/repository'
import type { PurchaseOrder, PurchaseOrderInput, Supplier, SupplierDraft } from '../domain/suppliers'

export type InventoryStatus = 'loading' | 'ready' | 'error'

export interface Inventory {
  status: InventoryStatus
  /** Which backend is live, once it has opened. */
  backend: InventoryRepository['kind'] | null
  /** The signed-in person's role — null until the backend has opened.
   *  Always 'manager' in local (offline demo) mode. */
  role: Role | null
  products: Product[]
  movements: StockMovement[]
  sales: Sale[]
  returns: ReturnCase[]
  /** Every add/edit/delete on a product, newest first — see `ActivityLogEntry`. */
  activity: ActivityLogEntry[]
  /** Only set when the backend could not be opened at all. */
  error: string | null
  createProduct(draft: ProductDraft): Promise<Result<Product>>
  updateProduct(id: string, draft: ProductDraft): Promise<Result<Product>>
  deleteProduct(id: string): Promise<Result<true>>
  recordMovement(productId: string, input: MovementInput): Promise<Result<AppliedMovement>>
  recordSale(input: SaleInput): Promise<Result<Sale>>
  /** Manager-only. Fully replaces a past sale's items/quantities/prices. */
  updateSale(id: string, input: SaleInput): Promise<Result<Sale>>
  recordReturn(input: ReturnCaseInput): Promise<Result<ReturnCase>>
  /** Manager-only. Fully replaces a past return case. */
  updateReturn(id: string, input: ReturnCaseInput): Promise<Result<ReturnCase>>
  /** Returns the freshly fetched catalogue, so callers can act on it directly
   *  rather than reading `products` from a stale render closure. */
  reload(): Promise<Product[]>
  listTeam(): Promise<TeamMember[]>
  inviteEmployee(email: string): Promise<Result<TeamMember>>
  removeTeamMember(membershipId: string): Promise<Result<true>>
  getProfile(): Promise<Profile>
  updateProfile(draft: ProfileDraft): Promise<Result<ProfileUpdateOutcome>>
  listPendingProfileChanges(): Promise<ProfileChangeRequest[]>
  approveProfileChange(requestId: string): Promise<Result<true>>
  rejectProfileChange(requestId: string): Promise<Result<true>>
  /** The signed-in person's own login email — '' in local (offline demo) mode. */
  getLoginEmail(): Promise<string>
  /** Requests a change to the signed-in person's own login email — see
   *  `InventoryRepository.updateLoginEmail` for the confirmation-link flow. */
  updateLoginEmail(newEmail: string): Promise<Result<true>>
  getAccountSettings(): Promise<AccountSettingsSync | null>
  setAccountSettings(patch: AccountSettingsSync): Promise<Result<true>>
  // Manager-only — see repository.ts's own doc comment on this section.
  // None of these affect products/movements/sales/returns/activity except
  // receivePurchaseOrder (it adds stock), so only that one goes through
  // `run`'s full-catalogue refresh; the rest are on-demand fetches, the
  // same pattern listTeam/getProfile already use below.
  listSuppliers(): Promise<Supplier[]>
  createSupplier(draft: SupplierDraft): Promise<Result<Supplier>>
  updateSupplier(id: string, draft: SupplierDraft): Promise<Result<Supplier>>
  deleteSupplier(id: string): Promise<Result<true>>
  listPurchaseOrders(): Promise<PurchaseOrder[]>
  createPurchaseOrder(input: PurchaseOrderInput): Promise<Result<PurchaseOrder>>
  sendPurchaseOrder(id: string): Promise<Result<PurchaseOrder>>
  confirmPurchaseOrder(id: string): Promise<Result<PurchaseOrder>>
  /** Adds stock for every line and marks the PO received — refreshes the
   *  product catalogue on success, unlike the other supplier/PO methods. */
  receivePurchaseOrder(id: string, lineQuantities: Map<string, number>): Promise<Result<PurchaseOrder>>
  cancelPurchaseOrder(id: string): Promise<Result<PurchaseOrder>>
}

const message = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

/**
 * Owns the repository and the catalogue it serves. Every write goes through
 * `run`, which refreshes the cached lists on success and turns a thrown
 * backend error (Supabase drops the network mid-write) into a failed Result
 * the calling screen can show inline.
 */
export function useInventory(open: () => Promise<InventoryRepository>): Inventory {
  // Held in a ref so an inline `open` prop cannot retrigger the load effect.
  const openRef = useRef(open)
  openRef.current = open
  const repoRef = useRef<InventoryRepository | null>(null)

  const [status, setStatus] = useState<InventoryStatus>('loading')
  const [backend, setBackend] = useState<InventoryRepository['kind'] | null>(null)
  const [role, setRole] = useState<Role | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [returns, setReturns] = useState<ReturnCase[]>([])
  const [activity, setActivity] = useState<ActivityLogEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (repo: InventoryRepository): Promise<Product[]> => {
    const [nextProducts, nextMovements, nextSales, nextReturns, nextActivity] = await Promise.all([
      repo.listProducts(),
      repo.listMovements(),
      repo.listSales(),
      repo.listReturns(),
      repo.listActivity(),
    ])
    setProducts(nextProducts)
    setMovements(nextMovements)
    setSales(nextSales)
    setReturns(nextReturns)
    setActivity(nextActivity)
    return nextProducts
  }, [])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const repo = repoRef.current ?? (await openRef.current())
        if (cancelled) return
        repoRef.current = repo
        setBackend(repo.kind)
        setRole(repo.role)
        await refresh(repo)
        if (cancelled) return
        setStatus('ready')
      } catch (cause) {
        if (cancelled) return
        setError(message(cause))
        setStatus('error')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [refresh])

  const run = useCallback(
    async <T,>(action: (repo: InventoryRepository) => Promise<Result<T>>): Promise<Result<T>> => {
      const repo = repoRef.current
      if (!repo) return { ok: false, error: 'Inventory is still loading.' }
      try {
        const result = await action(repo)
        if (result.ok) await refresh(repo)
        return result
      } catch (cause) {
        return { ok: false, error: message(cause) }
      }
    },
    [refresh],
  )

  const createProduct = useCallback(
    (draft: ProductDraft) => run((repo) => repo.createProduct(draft)),
    [run],
  )

  const updateProduct = useCallback(
    (id: string, draft: ProductDraft) => run((repo) => repo.updateProduct(id, draft)),
    [run],
  )

  const deleteProduct = useCallback((id: string) => run((repo) => repo.deleteProduct(id)), [run])

  const recordMovement = useCallback(
    (productId: string, input: MovementInput) =>
      run((repo) => repo.recordMovement(productId, input)),
    [run],
  )

  const recordSale = useCallback(
    (input: SaleInput) => run((repo) => repo.recordSale(input)),
    [run],
  )

  const updateSale = useCallback(
    (id: string, input: SaleInput) => run((repo) => repo.updateSale(id, input)),
    [run],
  )

  const recordReturn = useCallback(
    (input: ReturnCaseInput) => run((repo) => repo.recordReturn(input)),
    [run],
  )

  const updateReturn = useCallback(
    (id: string, input: ReturnCaseInput) => run((repo) => repo.updateReturn(id, input)),
    [run],
  )

  const reload = useCallback(async (): Promise<Product[]> => {
    const repo = repoRef.current
    if (!repo) return products
    return refresh(repo)
  }, [refresh, products])

  // Team membership doesn't affect products/movements/sales/returns, so
  // these skip `run`'s full-catalogue refresh rather than needing it — but
  // inviting/removing someone does log a new activity-log entry, so that one
  // list still needs a targeted refresh after a successful call, or a
  // manager sitting on the Activity tab wouldn't see it show up.
  const listTeam = useCallback(async () => {
    const repo = repoRef.current
    if (!repo) return []
    return repo.listTeam()
  }, [])

  const refreshActivity = useCallback(async () => {
    const repo = repoRef.current
    if (!repo) return
    try {
      setActivity(await repo.listActivity())
    } catch {
      // Best-effort — leave whatever was already loaded in place rather than
      // blocking on a list that isn't the thing the caller actually asked for.
    }
  }, [])

  const inviteEmployee = useCallback(
    async (email: string) => {
      const repo = repoRef.current
      if (!repo) return { ok: false as const, error: 'Inventory is still loading.' }
      try {
        const result = await repo.inviteEmployee(email)
        if (result.ok) await refreshActivity()
        return result
      } catch (cause) {
        return { ok: false as const, error: message(cause) }
      }
    },
    [refreshActivity],
  )

  const removeTeamMember = useCallback(
    async (membershipId: string) => {
      const repo = repoRef.current
      if (!repo) return { ok: false as const, error: 'Inventory is still loading.' }
      try {
        const result = await repo.removeTeamMember(membershipId)
        if (result.ok) await refreshActivity()
        return result
      } catch (cause) {
        return { ok: false as const, error: message(cause) }
      }
    },
    [refreshActivity],
  )

  // Profile/account settings, same shape as team membership above — none of
  // it affects the product catalogue, so these also skip `run`'s refresh.
  const getProfile = useCallback(async () => {
    const repo = repoRef.current
    if (!repo) return { fullName: '', birthday: '', address: '', employeeNumber: '', username: '', updatedAt: '' }
    return repo.getProfile()
  }, [])

  const updateProfile = useCallback(async (draft: ProfileDraft) => {
    const repo = repoRef.current
    if (!repo) return { ok: false as const, error: 'Inventory is still loading.' }
    try {
      return await repo.updateProfile(draft)
    } catch (cause) {
      return { ok: false as const, error: message(cause) }
    }
  }, [])

  const listPendingProfileChanges = useCallback(async () => {
    const repo = repoRef.current
    if (!repo) return []
    try {
      return await repo.listPendingProfileChanges()
    } catch {
      return []
    }
  }, [])

  const approveProfileChange = useCallback(async (requestId: string) => {
    const repo = repoRef.current
    if (!repo) return { ok: false as const, error: 'Inventory is still loading.' }
    try {
      return await repo.approveProfileChange(requestId)
    } catch (cause) {
      return { ok: false as const, error: message(cause) }
    }
  }, [])

  const rejectProfileChange = useCallback(async (requestId: string) => {
    const repo = repoRef.current
    if (!repo) return { ok: false as const, error: 'Inventory is still loading.' }
    try {
      return await repo.rejectProfileChange(requestId)
    } catch (cause) {
      return { ok: false as const, error: message(cause) }
    }
  }, [])

  const getLoginEmail = useCallback(async () => {
    const repo = repoRef.current
    if (!repo) return ''
    try {
      return await repo.getLoginEmail()
    } catch {
      return ''
    }
  }, [])

  const updateLoginEmail = useCallback(async (newEmail: string) => {
    const repo = repoRef.current
    if (!repo) return { ok: false as const, error: 'Inventory is still loading.' }
    try {
      return await repo.updateLoginEmail(newEmail)
    } catch (cause) {
      return { ok: false as const, error: message(cause) }
    }
  }, [])

  const getAccountSettings = useCallback(async () => {
    const repo = repoRef.current
    if (!repo) return null
    try {
      return await repo.getAccountSettings()
    } catch {
      return null
    }
  }, [])

  const setAccountSettings = useCallback(async (patch: AccountSettingsSync) => {
    const repo = repoRef.current
    if (!repo) return { ok: false as const, error: 'Inventory is still loading.' }
    try {
      return await repo.setAccountSettings(patch)
    } catch (cause) {
      return { ok: false as const, error: message(cause) }
    }
  }, [])

  const listSuppliers = useCallback(async () => {
    const repo = repoRef.current
    if (!repo) return []
    try {
      return await repo.listSuppliers()
    } catch {
      return []
    }
  }, [])

  const createSupplier = useCallback(async (draft: SupplierDraft) => {
    const repo = repoRef.current
    if (!repo) return { ok: false as const, error: 'Inventory is still loading.' }
    try {
      return await repo.createSupplier(draft)
    } catch (cause) {
      return { ok: false as const, error: message(cause) }
    }
  }, [])

  const updateSupplier = useCallback(async (id: string, draft: SupplierDraft) => {
    const repo = repoRef.current
    if (!repo) return { ok: false as const, error: 'Inventory is still loading.' }
    try {
      return await repo.updateSupplier(id, draft)
    } catch (cause) {
      return { ok: false as const, error: message(cause) }
    }
  }, [])

  const deleteSupplier = useCallback(async (id: string) => {
    const repo = repoRef.current
    if (!repo) return { ok: false as const, error: 'Inventory is still loading.' }
    try {
      return await repo.deleteSupplier(id)
    } catch (cause) {
      return { ok: false as const, error: message(cause) }
    }
  }, [])

  const listPurchaseOrders = useCallback(async () => {
    const repo = repoRef.current
    if (!repo) return []
    try {
      return await repo.listPurchaseOrders()
    } catch {
      return []
    }
  }, [])

  const createPurchaseOrder = useCallback(async (input: PurchaseOrderInput) => {
    const repo = repoRef.current
    if (!repo) return { ok: false as const, error: 'Inventory is still loading.' }
    try {
      return await repo.createPurchaseOrder(input)
    } catch (cause) {
      return { ok: false as const, error: message(cause) }
    }
  }, [])

  const sendPurchaseOrder = useCallback(async (id: string) => {
    const repo = repoRef.current
    if (!repo) return { ok: false as const, error: 'Inventory is still loading.' }
    try {
      return await repo.sendPurchaseOrder(id)
    } catch (cause) {
      return { ok: false as const, error: message(cause) }
    }
  }, [])

  const confirmPurchaseOrder = useCallback(async (id: string) => {
    const repo = repoRef.current
    if (!repo) return { ok: false as const, error: 'Inventory is still loading.' }
    try {
      return await repo.confirmPurchaseOrder(id)
    } catch (cause) {
      return { ok: false as const, error: message(cause) }
    }
  }, [])

  // Unlike the supplier/PO methods above, receiving a PO adds real stock —
  // goes through `run` so products/movements refresh the same way any other
  // stock-affecting write does.
  const receivePurchaseOrder = useCallback(
    (id: string, lineQuantities: Map<string, number>) =>
      run((repo) => repo.receivePurchaseOrder(id, lineQuantities)),
    [run],
  )

  const cancelPurchaseOrder = useCallback(async (id: string) => {
    const repo = repoRef.current
    if (!repo) return { ok: false as const, error: 'Inventory is still loading.' }
    try {
      return await repo.cancelPurchaseOrder(id)
    } catch (cause) {
      return { ok: false as const, error: message(cause) }
    }
  }, [])

  return {
    status,
    backend,
    role,
    products,
    movements,
    sales,
    returns,
    activity,
    error,
    createProduct,
    updateProduct,
    deleteProduct,
    recordMovement,
    recordSale,
    updateSale,
    recordReturn,
    updateReturn,
    reload,
    listTeam,
    inviteEmployee,
    removeTeamMember,
    getProfile,
    updateProfile,
    listPendingProfileChanges,
    approveProfileChange,
    rejectProfileChange,
    getLoginEmail,
    updateLoginEmail,
    getAccountSettings,
    setAccountSettings,
    listSuppliers,
    createSupplier,
    updateSupplier,
    deleteSupplier,
    listPurchaseOrders,
    createPurchaseOrder,
    sendPurchaseOrder,
    confirmPurchaseOrder,
    receivePurchaseOrder,
    cancelPurchaseOrder,
  }
}
