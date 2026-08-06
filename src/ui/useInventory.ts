import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppliedMovement } from '../domain/movements'
import type {
  MovementInput,
  Product,
  ProductDraft,
  Result,
  ReturnCase,
  ReturnCaseInput,
  Sale,
  SaleInput,
  StockMovement,
} from '../domain/types'
import type { InventoryRepository } from '../data/repository'

export type InventoryStatus = 'loading' | 'ready' | 'error'

export interface Inventory {
  status: InventoryStatus
  /** Which backend is live, once it has opened. */
  backend: InventoryRepository['kind'] | null
  products: Product[]
  movements: StockMovement[]
  sales: Sale[]
  returns: ReturnCase[]
  /** Only set when the backend could not be opened at all. */
  error: string | null
  createProduct(draft: ProductDraft): Promise<Result<Product>>
  updateProduct(id: string, draft: ProductDraft): Promise<Result<Product>>
  deleteProduct(id: string): Promise<Result<true>>
  recordMovement(productId: string, input: MovementInput): Promise<Result<AppliedMovement>>
  recordSale(input: SaleInput): Promise<Result<Sale>>
  recordReturn(input: ReturnCaseInput): Promise<Result<ReturnCase>>
  /** Returns the freshly fetched catalogue, so callers can act on it directly
   *  rather than reading `products` from a stale render closure. */
  reload(): Promise<Product[]>
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
  const [products, setProducts] = useState<Product[]>([])
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [returns, setReturns] = useState<ReturnCase[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (repo: InventoryRepository): Promise<Product[]> => {
    const [nextProducts, nextMovements, nextSales, nextReturns] = await Promise.all([
      repo.listProducts(),
      repo.listMovements(),
      repo.listSales(),
      repo.listReturns(),
    ])
    setProducts(nextProducts)
    setMovements(nextMovements)
    setSales(nextSales)
    setReturns(nextReturns)
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

  const recordReturn = useCallback(
    (input: ReturnCaseInput) => run((repo) => repo.recordReturn(input)),
    [run],
  )

  const reload = useCallback(async (): Promise<Product[]> => {
    const repo = repoRef.current
    if (!repo) return products
    return refresh(repo)
  }, [refresh, products])

  return {
    status,
    backend,
    products,
    movements,
    sales,
    returns,
    error,
    createProduct,
    updateProduct,
    deleteProduct,
    recordMovement,
    recordSale,
    recordReturn,
    reload,
  }
}
