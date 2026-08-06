import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { createRepository, resolveBackend, type Backend } from './data/createRepository'
import { getSupabaseClient } from './data/supabaseClient'
import { DUPLICATE_SKU, type InventoryRepository } from './data/repository'
import { findByScan } from './domain/inventory'
import { nextSku } from './domain/products'
import {
  addToCart,
  buildSaleInput,
  removeFromCart,
  setCartPrice,
  setCartQuantity,
  type Cart,
} from './domain/sales'
import type {
  MovementInput,
  MovementType,
  PaymentMethod,
  Product,
  ProductDraft,
  ReturnCaseInput,
  Sale,
} from './domain/types'
import type { StartCameraScan } from './scanner/cameraScanner'
import { useWedgeScanner } from './scanner/useWedgeScanner'
import { AuthScreen } from './ui/components/AuthScreen'
import { ConfirmDialog } from './ui/components/ConfirmDialog'
import { MovementDialog } from './ui/components/MovementDialog'
import { Nav, type Tab } from './ui/components/Nav'
import { ProductFormDialog } from './ui/components/ProductFormDialog'
import { ResetPasswordScreen } from './ui/components/ResetPasswordScreen'
import { printProductLabel } from './printing/printLabel'
import { CheckoutScreen } from './ui/screens/CheckoutScreen'
import { DashboardScreen } from './ui/screens/DashboardScreen'
import { HistoryScreen } from './ui/screens/HistoryScreen'
import { ProductsScreen } from './ui/screens/ProductsScreen'
import { ReturnsScreen } from './ui/screens/ReturnsScreen'
import { ScanScreen } from './ui/screens/ScanScreen'
import { SettingsScreen } from './ui/screens/SettingsScreen'
import { StocktakeScreen } from './ui/screens/StocktakeScreen'
import { useInventory } from './ui/useInventory'
import { useSettings } from './ui/useSettings'

export interface AppProps {
  /** Overridden in tests; defaults to the env-configured backend. */
  openRepository?: () => Promise<InventoryRepository>
  startCamera?: StartCameraScan
  /** Overridden in tests so the suite never touches the host's real localStorage. */
  settingsStorage?: Storage
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
  checkout: 'Checkout',
  returns: 'Returns',
  stocktake: 'Stocktake',
  history: 'History',
  settings: 'Settings',
}

const ENV = {
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
}

const defaultOpen = () => createRepository(ENV)

/**
 * Top-level gate. Local mode never needs a login, so it skips straight to
 * the app. Supabase mode waits for an authenticated session first, since
 * every table is locked to auth.uid() by Row Level Security.
 */
export function App(props: AppProps) {
  const backend = resolveBackend(ENV)

  // The auth gate only makes sense when the app is actually talking to the
  // real, env-configured backend. Callers that supply their own repository
  // (tests, previews) are trusted to manage their own data access, so they
  // skip straight to the app regardless of what's in .env.local.
  if (backend.kind === 'local' || props.openRepository) {
    return <AuthenticatedApp {...props} />
  }

  return <SupabaseGate backend={backend} {...props} />
}

function SupabaseGate({
  backend,
  ...props
}: AppProps & { backend: Extract<Backend, { kind: 'supabase' }> }) {
  const [session, setSession] = useState<Session | null>(null)
  const [checked, setChecked] = useState(false)
  // Supabase's reset-password email link lands back here already signed in
  // to a temporary session and fires this event — that must show the "set a
  // new password" screen instead of dropping straight into the app.
  const [recovering, setRecovering] = useState(false)
  const client = getSupabaseClient(backend.url, backend.anonKey)

  useEffect(() => {
    client.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setChecked(true)
    })
    const { data: sub } = client.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      setSession(next)
    })
    return () => sub.subscription.unsubscribe()
  }, [client])

  if (!checked) {
    return (
      <div className="boot">
        <h1>StockFlow</h1>
        <p className="muted" role="status">
          Checking sign-in status…
        </p>
      </div>
    )
  }

  if (recovering) {
    return <ResetPasswordScreen client={client} onDone={() => setRecovering(false)} />
  }

  if (!session) {
    return <AuthScreen client={client} />
  }

  return (
    <AuthenticatedApp
      {...props}
      onSignOut={() => client.auth.signOut()}
      userEmail={session.user.email ?? undefined}
    />
  )
}

interface AuthenticatedAppProps extends AppProps {
  onSignOut?: () => void
  userEmail?: string
}

function AuthenticatedApp({
  openRepository = defaultOpen,
  startCamera,
  settingsStorage,
  onSignOut,
  userEmail,
}: AuthenticatedAppProps) {
  const inventory = useInventory(openRepository)
  const settings = useSettings(settingsStorage)
  const [tab, setTab] = useState<Tab>('dashboard')
  const [lastScan, setLastScan] = useState<string | null>(null)
  const [cart, setCart] = useState<Cart>([])
  const [lastSale, setLastSale] = useState<Sale | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(timer)
  }, [toast])

  const addScanToCart = (code: string) => {
    const match = findByScan(inventory.products, code)
    if (!match) {
      setToast(`No product matches "${code.trim()}".`)
      return
    }
    setCart((current) => addToCart(current, match))
  }

  // On every other screen a scan looks a product up; on Checkout it rings
  // one up instead. Deliberately not memoised — useWedgeScanner re-reads
  // this closure on every render via a ref, so it always sees the current
  // tab without needing to re-subscribe its keydown listener.
  const handleScan = (code: string) => {
    const trimmed = code.trim()
    if (tab === 'checkout') {
      addScanToCart(trimmed)
      return
    }
    setLastScan(trimmed)
    setTab('scan')
  }

  // A wedge scanner types into whatever has focus, so capture is suspended
  // while a dialog is open and the user is working in its fields.
  useWedgeScanner(handleScan, { enabled: dialog === null })

  const closeDialog = () => setDialog(null)

  const saveProduct = async (draft: ProductDraft, opts: { autoSku: boolean }) => {
    const editing = dialog?.kind === 'product' ? dialog.product : undefined
    let result = editing
      ? await inventory.updateProduct(editing.id, draft)
      : await inventory.createProduct(draft)

    // An auto-picked SKU is only as fresh as the catalogue this dialog
    // opened with, so on a second device — or a tab left open a while — it
    // can collide with one added since. Refresh and regenerate once rather
    // than leaving the product unsaved with a confusing error.
    if (!editing && !result.ok && opts.autoSku && result.error === DUPLICATE_SKU) {
      const freshProducts = await inventory.reload()
      result = await inventory.createProduct({ ...draft, sku: nextSku(freshProducts) })
    }

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

  const printLabel = async (product: Product) => {
    setToast(`Sending ${product.name} label to the printer…`)
    const result = await printProductLabel(product, settings)
    setToast(result.ok ? `${product.name} label sent to the printer.` : `Print failed: ${result.error}`)
  }

  const checkoutSale = async (channel: string, paymentMethod: PaymentMethod) => {
    const result = await inventory.recordSale(buildSaleInput(cart, channel, paymentMethod))
    if (result.ok) {
      setLastSale(result.value)
      setCart([])
      setToast(`Sale recorded — ${result.value.subtotal.toFixed(2)} via ${channel}.`)
    }
    return result
  }

  const recordReturn = async (input: ReturnCaseInput) => {
    const result = await inventory.recordReturn(input)
    if (result.ok) {
      const summary = result.value.actions.length
        ? result.value.actions.join(', ')
        : 'note only'
      setToast(`Return case saved — ${summary}.`)
    }
    return result
  }

  const approveStocktakeLine = async (product: Product, counted: number) => {
    const result = await inventory.recordMovement(product.id, {
      type: 'adjust',
      quantity: counted,
      reason: 'Stocktake',
    })
    if (result.ok) {
      const { movement } = result.value
      setToast(`${product.name}: ${movement.previousQuantity} → ${movement.newQuantity}.`)
    }
    return result
  }

  const quickAdjust = async (product: Product, delta: 1 | -1) => {
    const result = await inventory.recordMovement(product.id, {
      type: delta > 0 ? 'in' : 'out',
      quantity: 1,
    })
    if (result.ok) {
      const { movement } = result.value
      setToast(`${product.name}: ${movement.previousQuantity} → ${movement.newQuantity}.`)
    } else {
      setToast(result.error)
    }
  }

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
          {onSignOut && (
            <>
              {userEmail && <span className="muted" style={{ marginLeft: '.6rem' }}>{userEmail}</span>}
              <button
                type="button"
                className="button button-ghost"
                style={{ marginLeft: '.6rem' }}
                onClick={onSignOut}
              >
                Sign out
              </button>
            </>
          )}
        </div>
      </header>

      <main className="app-main">
        <h2 className="screen-title">{TITLES[tab]}</h2>

        {tab === 'dashboard' && (
          <DashboardScreen
            products={inventory.products}
            movements={inventory.movements}
            sales={inventory.sales}
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
            onPrintLabel={printLabel}
          />
        )}

        {tab === 'scan' && (
          <ScanScreen
            products={inventory.products}
            lastScan={lastScan}
            onScan={handleScan}
            onMove={openMovement}
            onCreate={(barcode) => setDialog({ kind: 'product', barcode })}
            onQuickAdjust={quickAdjust}
            startCamera={startCamera}
          />
        )}

        {tab === 'checkout' && (
          <CheckoutScreen
            products={inventory.products}
            cart={cart}
            channels={settings.saleChannels}
            lastSale={lastSale}
            onAddByCode={addScanToCart}
            onAddProduct={(product) => setCart((current) => addToCart(current, product))}
            onSetQuantity={(id, quantity) => setCart((current) => setCartQuantity(current, id, quantity))}
            onSetPrice={(id, price) => setCart((current) => setCartPrice(current, id, price))}
            onRemove={(id) => setCart((current) => removeFromCart(current, id))}
            onAddChannel={settings.addChannel}
            onCheckout={checkoutSale}
            startCamera={startCamera}
          />
        )}

        {tab === 'returns' && (
          <ReturnsScreen
            products={inventory.products}
            sales={inventory.sales}
            returns={inventory.returns}
            onRecordReturn={recordReturn}
          />
        )}

        {tab === 'stocktake' && (
          <StocktakeScreen
            products={inventory.products}
            onApprove={approveStocktakeLine}
            onCreateProduct={(barcode) => setDialog({ kind: 'product', barcode })}
          />
        )}

        {tab === 'history' && (
          <HistoryScreen
            movements={inventory.movements}
            products={inventory.products}
            sales={inventory.sales}
          />
        )}

        {tab === 'settings' && <SettingsScreen settings={settings} />}
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
          products={inventory.products}
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
