import { useCallback, useEffect, useState } from 'react'
import { createRepository } from './data/createRepository'
import type { InventoryRepository } from './data/repository'
import type { MovementInput, MovementType, Product, ProductDraft } from './domain/types'
import type { StartCameraScan } from './scanner/cameraScanner'
import { useWedgeScanner } from './scanner/useWedgeScanner'
import { ConfirmDialog } from './ui/components/ConfirmDialog'
import { MovementDialog } from './ui/components/MovementDialog'
import { Nav, type Tab } from './ui/components/Nav'
import { ProductFormDialog } from './ui/components/ProductFormDialog'
import { DashboardScreen } from './ui/screens/DashboardScreen'
import { HistoryScreen } from './ui/screens/HistoryScreen'
import { ProductsScreen } from './ui/screens/ProductsScreen'
import { ScanScreen } from './ui/screens/ScanScreen'
import { useInventory } from './ui/useInventory'

export interface AppProps {
  /** Overridden in tests; defaults to the env-configured backend. */
  openRepository?: () => Promise<InventoryRepository>
  startCamera?: StartCameraScan
}

type DialogState =
  | { kind: 'product'; product?: Product; barcode?: string }
  | { kind: 'movement'; product: Product; type: MovementType }
  | { kind: 'delete'; product: Product }
  | null

const TITLES: Record<Tab, string> = {
  dashboard: 'Dashboard',
  products: 'Products',
  scan: 'Scan',
  history: 'History',
}

const defaultOpen = () =>
  createRepository({
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
  })

export function App({ openRepository = defaultOpen, startCamera }: AppProps) {
  const inventory = useInventory(openRepository)
  const [tab, setTab] = useState<Tab>('dashboard')
  const [lastScan, setLastScan] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(timer)
  }, [toast])

  const handleScan = useCallback((barcode: string) => {
    setLastScan(barcode.trim())
    setTab('scan')
  }, [])

  // A wedge scanner types into whatever has focus, so capture is suspended
  // while a dialog is open and the user is working in its fields.
  useWedgeScanner(handleScan, { enabled: dialog === null })

  const closeDialog = () => setDialog(null)

  const saveProduct = async (draft: ProductDraft) => {
    const editing = dialog?.kind === 'product' ? dialog.product : undefined
    const result = editing
      ? await inventory.updateProduct(editing.id, draft)
      : await inventory.createProduct(draft)
    if (result.ok) setToast(`${result.value.name} saved.`)
    return result
  }

  const saveMovement = async (input: MovementInput) => {
    if (dialog?.kind !== 'movement') return { ok: false as const, error: 'No product selected.' }
    const result = await inventory.recordMovement(dialog.product.id, input)
    if (result.ok) {
      const { product, movement } = result.value
      setToast(`${product.name}: ${movement.previousQuantity} → ${movement.newQuantity}.`)
    }
    return result
  }

  const confirmDelete = async () => {
    if (dialog?.kind !== 'delete') return
    const { product } = dialog
    const result = await inventory.deleteProduct(product.id)
    setToast(result.ok ? `${product.name} deleted.` : result.error)
    closeDialog()
  }

  const openMovement = (product: Product, type: MovementType) =>
    setDialog({ kind: 'movement', product, type })

  if (inventory.status === 'error') {
    return (
      <div className="boot">
        <h1>StockFlow</h1>
        <p className="alert" role="alert">
          {inventory.error}
        </p>
        <button type="button" className="button" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    )
  }

  if (inventory.status === 'loading') {
    return (
      <div className="boot">
        <h1>StockFlow</h1>
        <p className="muted" role="status">
          Opening the inventory…
        </p>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ▮▯▮
          </span>
          <h1>StockFlow</h1>
        </div>
        <div className="header-right">
          <span className="badge backend" data-testid="backend-badge">
            {inventory.backend === 'supabase' ? 'Supabase — synced' : 'Offline — on this device'}
          </span>
        </div>
      </header>

      <main className="app-main">
        <h2 className="screen-title">{TITLES[tab]}</h2>

        {tab === 'dashboard' && (
          <DashboardScreen
            products={inventory.products}
            movements={inventory.movements}
            onNavigate={setTab}
          />
        )}

        {tab === 'products' && (
          <ProductsScreen
            products={inventory.products}
            onMove={openMovement}
            onEdit={(product) => setDialog({ kind: 'product', product })}
            onDelete={(product) => setDialog({ kind: 'delete', product })}
            onCreate={() => setDialog({ kind: 'product' })}
          />
        )}

        {tab === 'scan' && (
          <ScanScreen
            products={inventory.products}
            lastScan={lastScan}
            onScan={handleScan}
            onMove={openMovement}
            onCreate={(barcode) => setDialog({ kind: 'product', barcode })}
            startCamera={startCamera}
          />
        )}

        {tab === 'history' && (
          <HistoryScreen movements={inventory.movements} products={inventory.products} />
        )}
      </main>

      <Nav tab={tab} onChange={setTab} />

      {toast && (
        <p className="toast" role="status">
          {toast}
        </p>
      )}

      {dialog?.kind === 'product' && (
        <ProductFormDialog
          product={dialog.product}
          barcode={dialog.barcode}
          onClose={closeDialog}
          onSubmit={saveProduct}
        />
      )}

      {dialog?.kind === 'movement' && (
        <MovementDialog
          product={dialog.product}
          type={dialog.type}
          onClose={closeDialog}
          onSubmit={saveMovement}
        />
      )}

      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title="Delete product?"
          message={`${dialog.product.name} will be removed from the catalogue. Its stock history is kept.`}
          confirmLabel="Delete"
          onCancel={closeDialog}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  )
}
