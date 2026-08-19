import { useEffect, useState } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { createRepository, resolveBackend, type Backend } from './data/createRepository'
import { clearProductDraft } from './data/productDraftStorage'
import { clearSaleEditDraft } from './data/saleEditDraftStorage'
import { getSupabaseClient } from './data/supabaseClient'
import { DUPLICATE_SKU, type InventoryRepository, type Role } from './data/repository'
import { findByScan } from './domain/inventory'
import { nextSku } from './domain/products'
import {
  addToCart,
  buildSaleInput,
  removeFromCart,
  setCartPrice,
  setCartQuantity,
  type Cart,
  type SaleFeesDraft,
} from './domain/sales'
import type {
  MovementInput,
  MovementType,
  PaymentMethod,
  Product,
  ProductDraft,
  ReturnCaseInput,
  Sale,
  SaleInput,
} from './domain/types'
import type { StartCameraScan } from './scanner/cameraScanner'
import { useWedgeScanner } from './scanner/useWedgeScanner'
import { AuthScreen } from './ui/components/AuthScreen'
import { ConfirmDialog } from './ui/components/ConfirmDialog'
import { MfaChallengeScreen } from './ui/components/MfaChallengeScreen'
import { MfaEnrollScreen } from './ui/components/MfaEnrollScreen'
import { MovementDialog } from './ui/components/MovementDialog'
import { Nav, type Tab } from './ui/components/Nav'
import { ProductFormDialog } from './ui/components/ProductFormDialog'
import { printProductLabel } from './printing/printLabel'
import { CheckoutScreen } from './ui/screens/CheckoutScreen'
import { DashboardScreen } from './ui/screens/DashboardScreen'
import { HistoryScreen, SaleEditDialog } from './ui/screens/HistoryScreen'
import { ProductsScreen } from './ui/screens/ProductsScreen'
import { QuickCodesScreen } from './ui/screens/QuickCodesScreen'
import { ReportsScreen } from './ui/screens/ReportsScreen'
import { ReturnsScreen } from './ui/screens/ReturnsScreen'
import { ScanScreen } from './ui/screens/ScanScreen'
import { SettingsScreen } from './ui/screens/SettingsScreen'
import { StocktakeScreen } from './ui/screens/StocktakeScreen'
import { useInventory } from './ui/useInventory'
import { useSettings } from './ui/useSettings'
import { useSettingsSync } from './ui/useSettingsSync'

export interface AppProps {
  /** Overridden in tests; defaults to the env-configured backend. */
  openRepository?: () => Promise<InventoryRepository>
  startCamera?: StartCameraScan
  /** Overridden in tests so the suite never touches the host's real localStorage. */
  settingsStorage?: Storage
  /** Overridden in tests; backs the product-form autosave (see productDraftStorage.ts). */
  productDraftStorage?: Storage
  /** Overridden in tests; backs the Edit-sale dialog's autosave (see saleEditDraftStorage.ts). */
  saleEditDraftStorage?: Storage
  /** Overridden in tests; backs the sign-in screen's remembered-email suggestions (see recentEmailsStorage.ts). */
  emailStorage?: Storage
}

type DialogState =
  | { kind: 'product'; product?: Product; barcode?: string }
  | { kind: 'movement'; product: Product; type: MovementType }
  | { kind: 'delete'; product: Product }
  | { kind: 'saleEdit'; sale: Sale }
  | null

const TITLES: Record<Tab, string> = {
  dashboard: 'Dashboard',
  products: 'Products',
  scan: 'Scan',
  checkout: 'Checkout',
  returns: 'Returns',
  stocktake: 'Stocktake',
  history: 'History',
  reports: 'Reports',
  codes: 'Quick codes',
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

/** Mandatory-MFA gate state, checked fresh every time the session changes
 *  (sign-in, sign-out, or a just-verified TOTP challenge). */
type MfaStatus =
  | { kind: 'checking' }
  | { kind: 'needsEnroll' }
  | { kind: 'needsChallenge'; factorId: string }
  | { kind: 'satisfied' }

async function loadMfaStatus(client: SupabaseClient): Promise<MfaStatus> {
  // `listFactors()`'s per-type buckets (`data.totp`) only ever contain
  // already-verified factors — that filtering is done by Supabase, not
  // here — so the first entry is exactly what's needed.
  const { data: factorsData, error: factorsError } = await client.auth.mfa.listFactors()
  if (factorsError) return { kind: 'needsEnroll' }

  const verifiedTotp = factorsData?.totp?.[0]
  if (!verifiedTotp) return { kind: 'needsEnroll' }

  const { data: aal, error: aalError } = await client.auth.mfa.getAuthenticatorAssuranceLevel()
  if (aalError) return { kind: 'needsChallenge', factorId: verifiedTotp.id }

  if (aal.currentLevel !== aal.nextLevel) {
    return { kind: 'needsChallenge', factorId: verifiedTotp.id }
  }

  return { kind: 'satisfied' }
}

function SupabaseGate({
  backend,
  ...props
}: AppProps & { backend: Extract<Backend, { kind: 'supabase' }> }) {
  const [session, setSession] = useState<Session | null>(null)
  const [checked, setChecked] = useState(false)
  const [mfa, setMfa] = useState<MfaStatus>({ kind: 'checking' })
  const client = getSupabaseClient(backend.url, backend.anonKey)

  useEffect(() => {
    client.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setChecked(true)
    })
    const { data: sub } = client.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })
    return () => sub.subscription.unsubscribe()
  }, [client])

  // Every StockFlow account must have a verified authenticator app and be at
  // AAL2 before it can touch any inventory data — enforced again, server
  // side, by the RLS policies in schema.sql, so this check can't be bypassed
  // by skipping the UI.
  useEffect(() => {
    if (!session) {
      setMfa({ kind: 'checking' })
      return
    }
    let cancelled = false
    setMfa({ kind: 'checking' })
    void loadMfaStatus(client).then((status) => {
      if (!cancelled) setMfa(status)
    })
    return () => {
      cancelled = true
    }
  }, [client, session])

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

  if (!session) {
    return <AuthScreen client={client} emailStorage={props.emailStorage} />
  }

  const recheckMfa = () => void loadMfaStatus(client).then(setMfa)

  if (mfa.kind === 'checking') {
    return (
      <div className="boot">
        <h1>StockFlow</h1>
        <p className="muted" role="status">
          Checking two-factor status…
        </p>
      </div>
    )
  }

  if (mfa.kind === 'needsEnroll') {
    return <MfaEnrollScreen client={client} onEnrolled={recheckMfa} />
  }

  if (mfa.kind === 'needsChallenge') {
    return (
      <MfaChallengeScreen
        client={client}
        factorId={mfa.factorId}
        onVerified={recheckMfa}
        onSignOut={() => client.auth.signOut()}
      />
    )
  }

  return (
    <AuthenticatedApp
      {...props}
      onSignOut={() => {
        // Both drafts are in-progress edits tied to whoever is signed in —
        // neither should resurface for the next person to sign in on this
        // device (see productDraftStorage.ts / saleEditDraftStorage.ts).
        clearProductDraft(props.productDraftStorage)
        clearSaleEditDraft(props.saleEditDraftStorage)
        client.auth.signOut()
      }}
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
  productDraftStorage,
  saleEditDraftStorage,
  onSignOut,
  userEmail,
}: AuthenticatedAppProps) {
  const inventory = useInventory(openRepository)
  // Screens are only reached once inventory.status === 'ready', by which
  // point useInventory has already set a real role — 'employee' here is
  // just a fail-closed fallback for the instant before that.
  const role: Role = inventory.role ?? 'employee'
  const settings = useSettings(settingsStorage)
  useSettingsSync(inventory, settings)
  const [tab, setTab] = useState<Tab>('dashboard')
  const [lastScan, setLastScan] = useState<string | null>(null)
  const [cart, setCart] = useState<Cart>([])
  const [lastSale, setLastSale] = useState<Sale | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [toast, setToast] = useState<string | null>(null)
  // A sale looked up by scanning the QR code printed on its own receipt —
  // see handleScan below and the "Scan to find this sale" code CheckoutScreen
  // prints. Handed to HistoryScreen, which pops the sale's receipt open and
  // clears this back to null once it has.
  const [recalledSale, setRecalledSale] = useState<Sale | null>(null)

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
  // one up instead; on History it's a receipt's own code, recalling that
  // exact sale. Deliberately not memoised — useWedgeScanner re-reads this
  // closure on every render via a ref, so it always sees the current tab
  // without needing to re-subscribe its keydown listener.
  const handleScan = (code: string) => {
    const trimmed = code.trim()
    if (tab === 'checkout') {
      addScanToCart(trimmed)
      return
    }
    if (tab === 'history') {
      const sale = inventory.sales.find((s) => s.id === trimmed)
      if (!sale) {
        setToast(`No sale matches "${trimmed}".`)
        return
      }
      setRecalledSale(sale)
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
      setToast(`${product.name}: ${movement.previousQuantity} â ${movement.newQuantity}.`)
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

  const checkoutSale = async (channel: string, paymentMethod: PaymentMethod, fees: SaleFeesDraft) => {
    const result = await inventory.recordSale(buildSaleInput(cart, channel, paymentMethod, fees))
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

  const updateSale = async (id: string, input: SaleInput) => {
    const result = await inventory.updateSale(id, input)
    if (result.ok) {
      setToast(`Sale updated — now ${result.value.subtotal.toFixed(2)} via ${result.value.channel || 'Unspecified'}.`)
    }
    return result
  }

  const updateReturn = async (id: string, input: ReturnCaseInput) => {
    const result = await inventory.updateReturn(id, input)
    if (result.ok) {
      setToast('Return case updated.')
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
          Opening the inventoryâ¦
        </p>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            â®â¯â®
          </span>
          <h1>StockFlow</h1>
        </div>
        <div className="header-right">
          <span className="badge backend" data-testid="backend-badge">
            {inventory.backend === 'supabase' ? 'Supabase â synced' : 'Offline â on this device'}
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
            role={role}
            movements={inventory.movements}
            sales={inventory.sales}
            onNavigate={setTab}
          />
        )}

        {tab === 'products' && (
          <ProductsScreen
            products={inventory.products}
            role={role}
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
            role={role}
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
            role={role}
            sales={inventory.sales}
            returns={inventory.returns}
            onRecordReturn={recordReturn}
            onUpdateReturn={updateReturn}
          />
        )}

        {tab === 'stocktake' && (
          <StocktakeScreen
            products={inventory.products}
            role={role}
            onApprove={approveStocktakeLine}
            onCreateProduct={(barcode) => setDialog({ kind: 'product', barcode })}
          />
        )}

        {tab === 'history' && (
          <HistoryScreen
            movements={inventory.movements}
            products={inventory.products}
            sales={inventory.sales}
            activity={inventory.activity}
            role={role}
            onEditSale={(sale) => setDialog({ kind: 'saleEdit', sale })}
            recalledSale={recalledSale}
            onRecalledSaleHandled={() => setRecalledSale(null)}
          />
        )}

        {tab === 'reports' && role === 'manager' && (
          <ReportsScreen
            products={inventory.products}
            sales={inventory.sales}
            movements={inventory.movements}
          />
        )}

        {tab === 'codes' && role === 'manager' && <QuickCodesScreen settings={settings} />}

        {tab === 'settings' && <SettingsScreen settings={settings} inventory={inventory} />}
      </main>

      <Nav tab={tab} onChange={setTab} hiddenTabs={role === 'manager' ? [] : ['reports', 'codes']} />

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
          categories={settings.productCategories}
          role={role}
          onClose={closeDialog}
          onSubmit={saveProduct}
          draftStorage={productDraftStorage}
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

      {dialog?.kind === 'saleEdit' && (
        <SaleEditDialog
          sale={dialog.sale}
          products={inventory.products}
          channels={settings.saleChannels}
          role={role}
          onClose={closeDialog}
          onSave={updateSale}
          draftStorage={saleEditDraftStorage}
        />
      )}
    </div>
  )
}
