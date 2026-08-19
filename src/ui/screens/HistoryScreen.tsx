import { useEffect, useId, useMemo, useState } from 'react'
import type { Role } from '../../data/repository'
import { searchProducts } from '../../domain/inventory'
import { movementsToCsv, salesToCsv } from '../../domain/csv'
import {
  addToCart,
  breakdownByChannel,
  breakdownByPaymentMethod,
  breakdownByProduct,
  buildEditCart,
  buildSaleInput,
  cartTotals,
  checkOrderTotal,
  editCartHasIssues,
  editCartLineIssue,
  removeFromCart,
  resolveSaleFeesDraft,
  saleFeesDraftFromSale,
  saleFeeTotal,
  salesSince,
  setCartPrice,
  setCartQuantity,
  summariseSales,
  type Cart,
  type SaleFeesDraft,
} from '../../domain/sales'
import {
  ACTIVITY_ACTION_LABELS,
  ACTIVITY_ENTITY_LABELS,
  PAID_BY_LABELS,
  MOVEMENT_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type ActivityEntityType,
  type ActivityLogEntry,
  type PaymentMethod,
  type Product,
  type Result,
  type Sale,
  type SaleInput,
  type StockMovement,
} from '../../domain/types'
import { Dialog } from '../components/Dialog'
import { SaleFeesFields } from '../components/SaleFeesFields'
import { downloadCsv, timestampedFilename } from '../csvDownload'
import { formatDateTime, formatDelta, formatNumber, formatRelativeTime } from '../format'
import {
  clearSaleEditDraft,
  hydrateSaleEditCart,
  loadSaleEditDraftFor,
  saveSaleEditDraft,
} from '../../data/saleEditDraftStorage'

/** The full itemised receipt for one past sale, opened from a row in the
 * sales list below — the same line-by-line breakdown Checkout shows right
 * after a sale, so it's never lost once you've navigated away. A manager can
 * also jump straight from here into editing it. */
function ReceiptDialog({
  sale,
  isManager,
  onClose,
  onEdit,
}: {
  sale: Sale
  isManager: boolean
  onClose: () => void
  onEdit: () => void
}) {
  return (
    <Dialog title="Receipt" onClose={onClose}>
      <p className="muted">{formatDateTime(sale.createdAt)}</p>
      {sale.updatedAt && <p className="muted">Last edited {formatDateTime(sale.updatedAt)}</p>}
      <p className="muted">Sold via {sale.channel || 'Unspecified'}</p>
      <table className="receipt-lines">
        <tbody>
          {sale.lines.map((line) => (
            <tr key={line.id}>
              <td>
                {line.quantity} × {line.name} ({line.sku})
              </td>
              <td className="receipt-amount">{line.lineTotal.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="receipt-total">Total: {sale.subtotal.toFixed(2)}</p>
      <p>Payment: {PAYMENT_METHOD_LABELS[sale.paymentMethod]}</p>
      {isManager &&
        ((sale.buyerProtectionFee ?? 0) > 0 ||
          (sale.deliveryCost ?? 0) > 0 ||
          (sale.vat ?? 0) > 0 ||
          (sale.advertisingCost ?? 0) > 0 ||
          (sale.orderTotal !== null && sale.orderTotal !== undefined)) && (
          <p className="muted" data-testid="receipt-fees">
            {(sale.buyerProtectionFee ?? 0) > 0 &&
              `Buyer protection ${sale.buyerProtectionFee!.toFixed(2)} (${PAID_BY_LABELS[sale.buyerProtectionFeePaidBy ?? 'seller']} paid) · `}
            {(sale.deliveryCost ?? 0) > 0 &&
              `Delivery ${sale.deliveryCost!.toFixed(2)} (${PAID_BY_LABELS[sale.deliveryPaidBy ?? 'seller']} paid) · `}
            {(sale.vat ?? 0) > 0 && `VAT ${sale.vat!.toFixed(2)} · `}
            {(sale.advertisingCost ?? 0) > 0 && `Advertising ${sale.advertisingCost!.toFixed(2)} · `}
            {sale.orderTotal !== null && sale.orderTotal !== undefined && `Order total ${sale.orderTotal.toFixed(2)}`}
          </p>
        )}
      {isManager && <p className="muted">Profit: {sale.profit.toFixed(2)}</p>}
      <div className="dialog-actions">
        {isManager && (
          <button type="button" className="button" onClick={onEdit}>
            Edit sale
          </button>
        )}
        <button type="button" className="button button-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  )
}

/** Full edit of a past sale — items, quantities, prices, channel and payment
 * method all reopen for change. Styled after Checkout's cart, but scoped to
 * a dialog and seeded from the sale being edited.
 *
 * Rendered at the top level of the app (see App.tsx), not nested inside
 * History's Sales view — so switching to another StockFlow tab while
 * editing no longer tears this dialog down (the same reason
 * ProductFormDialog lives at that level). Autosaves to localStorage on top
 * of that, same pattern as productDraftStorage.ts, so an in-progress edit
 * also survives an actual browser-tab/app switch or reload. */
export function SaleEditDialog({
  sale,
  products,
  channels,
  role,
  onClose,
  onSave,
  draftStorage,
}: {
  sale: Sale
  products: Product[]
  channels: string[]
  role: Role
  onClose: () => void
  onSave: (id: string, input: SaleInput) => Promise<Result<Sale>>
  /** Overridden in tests so the suite never touches the host's real localStorage. */
  draftStorage?: Storage
}) {
  const searchId = useId()

  const initialCart = useMemo(() => buildEditCart(sale, products), [sale, products])
  const droppedCount = sale.lines.length - initialCart.length

  const restoredDraft = loadSaleEditDraftFor(sale.id, draftStorage)

  const [cart, setCart] = useState<Cart>(() =>
    restoredDraft ? hydrateSaleEditCart(restoredDraft.cart, products) : initialCart,
  )
  const [channel, setChannel] = useState(restoredDraft?.channel ?? sale.channel)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    restoredDraft?.paymentMethod ?? sale.paymentMethod,
  )
  const [fees, setFees] = useState<SaleFeesDraft>(() => restoredDraft?.fees ?? saleFeesDraftFromSale(sale))
  // Whether this dialog opened with unsaved work already sitting in the
  // autosave — shown as a note with the option to start over instead.
  const [restored, setRestored] = useState(restoredDraft !== null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Autosaves on every change so an in-progress edit survives switching
  // tabs, the phone backgrounding the PWA, or an accidental close — cleared
  // only by a successful save (below) or by signing out (see App.tsx).
  useEffect(() => {
    saveSaleEditDraft(sale.id, cart, channel, paymentMethod, fees, draftStorage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, channel, paymentMethod, fees, draftStorage, sale.id])

  const discardDraft = () => {
    clearSaleEditDraft(draftStorage)
    setCart(initialCart)
    setChannel(sale.channel)
    setPaymentMethod(sale.paymentMethod)
    setFees(saleFeesDraftFromSale(sale))
    setRestored(false)
  }

  // Keep the sale's original channel selectable even if it's since been
  // removed from Settings' managed list — otherwise reopening an old sale
  // would silently strand its channel with nothing selected.
  const channelOptions = channels.includes(channel) ? channels : [channel, ...channels].filter(Boolean)

  const totals = cartTotals(cart)
  const hasIssues = editCartHasIssues(cart, sale)
  const resolvedFees = resolveSaleFeesDraft(fees)
  const netProfit = totals.profit - saleFeeTotal(resolvedFees)
  const orderTotalCheck = checkOrderTotal(totals.subtotal, resolvedFees)

  const matches = useMemo(() => {
    if (!query.trim()) return []
    return searchProducts(products, query).slice(0, 6)
  }, [products, query])

  const save = async () => {
    setError(null)
    if (cart.length === 0) {
      setError('Add at least one item before saving.')
      return
    }
    if (hasIssues) {
      setError('Fix the stock issues below before saving.')
      return
    }
    if (!channel) {
      setError('Choose where this was sold.')
      return
    }

    setSaving(true)
    const result = await onSave(sale.id, buildSaleInput(cart, channel, paymentMethod, fees))
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    clearSaleEditDraft(draftStorage)
    onClose()
  }

  return (
    <Dialog title="Edit sale" onClose={onClose}>
      {restored && (
        // Text only, deliberately not a focusable control — Dialog focuses
        // the first input/button on mount so a keystroke lands in the
        // search field right away; an interactive element here would steal
        // that focus. The "Discard draft" button lives in the actions row.
        <p className="hint" role="status">
          Picked up where you left off — this wasn't saved yet.
        </p>
      )}
      <p className="muted">{formatDateTime(sale.createdAt)}</p>
      {droppedCount > 0 && (
        <p className="hint">
          {droppedCount} item{droppedCount === 1 ? '' : 's'} on the original sale no longer exist and{' '}
          {droppedCount === 1 ? 'has' : 'have'} been dropped from this edit.
        </p>
      )}

      <div className="field">
        <label htmlFor={searchId}>Add an item</label>
        <input
          id={searchId}
          type="search"
          value={query}
          autoComplete="off"
          placeholder="Product name, SKU, category…"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {matches.length > 0 && (
        <ul className="plain-list checkout-search-results">
          {matches.map((product) => (
            <li key={product.id} className="checkout-search-row">
              <span className="checkout-search-name">{product.name}</span>
              <span className="mono muted">{product.sku}</span>
              <button
                type="button"
                className="button button-ghost"
                onClick={() => {
                  setCart((current) => addToCart(current, product))
                  setQuery('')
                }}
              >
                Add
              </button>
            </li>
          ))}
        </ul>
      )}

      {cart.length === 0 ? (
        <p className="empty">No items left on this sale — add one above before saving.</p>
      ) : (
        <ul className="plain-list cart-list">
          {cart.map((line) => {
            const issue = editCartLineIssue(line, sale)
            return (
              <li key={line.product.id} className="cart-row" data-testid="edit-sale-cart-row">
                <div className="cart-identity">
                  <span className="product-name">{line.product.name}</span>
                  <span className="mono muted">{line.product.sku}</span>
                  {issue && (
                    <span className="stock-warning" role="alert">
                      {issue}
                    </span>
                  )}
                </div>
                <div className="cart-fields">
                  <label className="cart-field">
                    <span>Qty</span>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      inputMode="numeric"
                      value={line.quantity}
                      aria-label={`Quantity for ${line.product.name}`}
                      onChange={(e) => {
                        const parsed = Number(e.target.value)
                        if (!Number.isFinite(parsed)) return
                        setCart((current) =>
                          setCartQuantity(current, line.product.id, Math.max(1, Math.trunc(parsed))),
                        )
                      }}
                    />
                  </label>
                  <label className="cart-field">
                    <span>Item price</span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      inputMode="decimal"
                      value={line.unitPrice}
                      aria-label={`Item price for ${line.product.name}`}
                      disabled={role !== 'manager'}
                      title={
                        role !== 'manager'
                          ? 'Only a manager can change the sale price'
                          : "What you got for this item alone — not a marketplace order total. Any buyer protection fee, delivery, VAT etc. go in Marketplace fees below, not in here."
                      }
                      onChange={(e) =>
                        setCart((current) => setCartPrice(current, line.product.id, Number(e.target.value) || 0))
                      }
                    />
                  </label>
                  <span className="cart-line-total">{(line.unitPrice * line.quantity).toFixed(2)}</span>
                  <button
                    type="button"
                    className="button button-ghost"
                    aria-label={`Remove ${line.product.name} from sale`}
                    onClick={() => setCart((current) => removeFromCart(current, line.product.id))}
                  >
                    Remove
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {cart.length > 0 && (
        <div className="cart-totals" data-testid="edit-sale-totals">
          <span>Subtotal: {totals.subtotal.toFixed(2)}</span>
          {role === 'manager' && <span>Est. profit: {netProfit.toFixed(2)}</span>}
        </div>
      )}

      <div className="field">
        <span>Sold on</span>
        <div className="channel-picker">
          {channelOptions.map((name) => (
            <button
              key={name}
              type="button"
              className={`button chip-button ${channel === name ? 'chip-button-active' : ''}`}
              aria-pressed={channel === name}
              onClick={() => setChannel(name)}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span>Payment method</span>
        <div className="channel-picker">
          {PAYMENT_METHODS.map((method) => (
            <button
              key={method}
              type="button"
              className={`button chip-button ${paymentMethod === method ? 'chip-button-active' : ''}`}
              aria-pressed={paymentMethod === method}
              onClick={() => setPaymentMethod(method)}
            >
              {PAYMENT_METHOD_LABELS[method]}
            </button>
          ))}
        </div>
      </div>

      <SaleFeesFields value={fees} onChange={setFees} />
      {orderTotalCheck && (
        <p
          className={`order-total-check ${orderTotalCheck.matches ? '' : 'order-total-check-mismatch'}`}
          data-testid="order-total-check"
        >
          {orderTotalCheck.matches
            ? `Matches your order total (${orderTotalCheck.entered.toFixed(2)}).`
            : `You've itemised ${orderTotalCheck.itemised.toFixed(2)}, but entered an order total of ${orderTotalCheck.entered.toFixed(2)} — ${
                orderTotalCheck.difference > 0
                  ? `you're ${orderTotalCheck.difference.toFixed(2)} short. Check you haven't missed a fee.`
                  : `that's ${Math.abs(orderTotalCheck.difference).toFixed(2)} more than the order total. Check the item price above isn't already including a fee you've also entered below.`
              }`}
        </p>
      )}

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <div className="dialog-actions">
        {restored && (
          <button type="button" className="button button-ghost" onClick={discardDraft} disabled={saving}>
            Discard draft
          </button>
        )}
        <button type="button" className="button button-ghost" onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button type="button" className="button button-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </Dialog>
  )
}

/** Read-only drill-down for one stock movement — a movement is an audit-trail
 * entry, not a document, so there's no edit path here; a correction happens
 * either by editing the sale/return that produced it, or with a fresh manual
 * adjustment. */
function MovementDetailDialog({
  movement,
  productName,
  onClose,
}: {
  movement: StockMovement
  productName: string
  onClose: () => void
}) {
  return (
    <Dialog title="Stock movement" onClose={onClose}>
      <p className="muted">{formatDateTime(movement.createdAt)}</p>
      <p>
        <strong>{productName}</strong>
      </p>
      <p>
        <span className={`badge badge-${movement.type}`}>{MOVEMENT_LABELS[movement.type]}</span>
      </p>
      <p>
        {movement.previousQuantity} → {movement.newQuantity}{' '}
        <span className={`delta delta-${movement.delta < 0 ? 'down' : 'up'}`}>
          ({formatDelta(movement.delta)})
        </span>
      </p>
      {movement.reason && <p className="reason">{movement.reason}</p>}
      <div className="dialog-actions">
        <button type="button" className="button button-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  )
}

export interface HistoryScreenProps {
  movements: StockMovement[]
  products: Product[]
  sales: Sale[]
  /** Every add/edit/delete on a product, newest first — see the "Activity"
   * tab below. Visible to the whole team, same as stock movements. */
  activity: ActivityLogEntry[]
  role: Role
  /** Opens the sale in the top-level Edit sale dialog (see App.tsx and
   *  SaleEditDialog's own doc comment for why it lives up there). */
  onEditSale: (sale: Sale) => void
  /** A sale looked up from a scanned receipt code (see App.tsx's
   * handleScan) — pops its receipt straight open, regardless of the
   * current date-range filter, the moment it arrives. `onRecalledSaleHandled`
   * clears it back to null once consumed, so re-scanning the same code
   * later still reopens it rather than being ignored as a no-op prop change. */
  recalledSale?: Sale | null
  onRecalledSaleHandled?: () => void
}

type Mode = 'movements' | 'sales' | 'activity'
type Range = 'today' | '7d' | '30d' | 'all'

const RANGE_LABELS: Record<Range, string> = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  all: 'All time',
}

/** Midnight local time, or far enough back to include everything for "all". */
function rangeStart(range: Range): Date {
  const now = new Date()
  if (range === 'all') return new Date(0)
  if (range === 'today') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  }
  const days = range === '7d' ? 7 : 30
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}

function MovementsView({ movements, products }: { movements: StockMovement[]; products: Product[] }) {
  const searchId = useId()
  const [query, setQuery] = useState('')
  const [viewingMovement, setViewingMovement] = useState<StockMovement | null>(null)

  const names = useMemo(
    () => Object.fromEntries(products.map((p) => [p.id, p.name])),
    [products],
  )

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return movements
    return movements.filter((movement) =>
      [names[movement.productId] ?? '', movement.reason ?? '', MOVEMENT_LABELS[movement.type]]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    )
  }, [movements, names, query])

  return (
    <>
      <div className="toolbar">
        <div className="field field-grow">
          <label htmlFor={searchId}>Search history</label>
          <input
            id={searchId}
            type="search"
            value={query}
            autoComplete="off"
            placeholder="Product, reason or movement type"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="toolbar-actions">
          <button
            type="button"
            className="button"
            onClick={() =>
              downloadCsv(timestampedFilename('stock-history'), movementsToCsv(visible, names))
            }
          >
            Export history CSV
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="empty">
          {movements.length === 0
            ? 'No stock movements yet. Every stock in, out and adjustment lands here.'
            : 'No movements match that search.'}
        </p>
      ) : (
        <ul className="plain-list history-list">
          {visible.map((movement) => (
            <li key={movement.id} className="history-row" data-testid="movement-row">
              <div className="history-main">
                <span className="history-product">
                  {names[movement.productId] ?? 'Deleted product'}
                </span>
                <span className={`badge badge-${movement.type}`}>
                  {MOVEMENT_LABELS[movement.type]}
                </span>
              </div>
              <div className="history-numbers">
                <span className={`delta delta-${movement.delta < 0 ? 'down' : 'up'}`}>
                  {formatDelta(movement.delta)}
                </span>
                <span className="muted">
                  {movement.previousQuantity} → {movement.newQuantity}
                </span>
              </div>
              <div className="history-meta">
                <span className="muted">{formatDateTime(movement.createdAt)}</span>
                {movement.reason && <span className="reason">{movement.reason}</span>}
              </div>
              <div className="dialog-actions">
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={() => setViewingMovement(movement)}
                >
                  View details
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {viewingMovement && (
        <MovementDetailDialog
          movement={viewingMovement}
          productName={names[viewingMovement.productId] ?? 'Deleted product'}
          onClose={() => setViewingMovement(null)}
        />
      )}
    </>
  )
}

type EntityFilter = 'all' | ActivityEntityType

const ENTITY_FILTER_LABELS: Record<EntityFilter, string> = {
  all: 'All',
  ...ACTIVITY_ENTITY_LABELS,
}

/** Every product/sale/return/team change, attributable to who did it and
 * when — manager-only (see HistoryScreen's own gating below and the
 * `activity_log_select_own` RLS policy in activity_log_migration.sql, which
 * enforces the same restriction server-side). Read-only: there's nothing
 * here to open or reverse, just a record. */
function ActivityView({ activity }: { activity: ActivityLogEntry[] }) {
  const searchId = useId()
  const [query, setQuery] = useState('')
  const [entityFilter, setEntityFilter] = useState<EntityFilter>('all')

  const visible = useMemo(() => {
    const byType = entityFilter === 'all' ? activity : activity.filter((entry) => entry.entityType === entityFilter)
    const needle = query.trim().toLowerCase()
    if (!needle) return byType
    return byType.filter((entry) =>
      [entry.actorName, entry.entityLabel, entry.detail, ACTIVITY_ACTION_LABELS[entry.action], entry.entityType]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    )
  }, [activity, entityFilter, query])

  return (
    <>
      <div className="toolbar">
        <div className="field field-grow">
          <label htmlFor={searchId}>Search activity</label>
          <input
            id={searchId}
            type="search"
            value={query}
            autoComplete="off"
            placeholder="Person, product or change"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      <div className="channel-picker" role="group" aria-label="Filter by type">
        {(Object.keys(ENTITY_FILTER_LABELS) as EntityFilter[]).map((value) => (
          <button
            key={value}
            type="button"
            className={`button chip-button ${entityFilter === value ? 'chip-button-active' : ''}`}
            aria-pressed={entityFilter === value}
            onClick={() => setEntityFilter(value)}
          >
            {ENTITY_FILTER_LABELS[value]}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="empty">
          {activity.length === 0
            ? 'No activity yet. Every product, sale, return or team change lands here.'
            : 'No activity matches that search.'}
        </p>
      ) : (
        <ul className="plain-list history-list">
          {visible.map((entry) => (
            <li key={entry.id} className="history-row" data-testid="activity-row">
              <div className="history-main">
                <span className="history-product">
                  {entry.actorName} {ACTIVITY_ACTION_LABELS[entry.action]}{' '}
                  {entry.entityLabel || `a deleted ${entry.entityType}`}
                </span>
                <span className={`badge badge-activity-${entry.action}`}>
                  {ACTIVITY_ACTION_LABELS[entry.action]}
                </span>
              </div>
              <div className="history-meta">
                <span className="muted" title={formatDateTime(entry.createdAt)}>
                  {formatRelativeTime(entry.createdAt)}
                </span>
                {entry.detail && <span className="reason">— {entry.detail}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function SalesView({
  sales,
  role,
  onEditSale,
  recalledSale,
  onRecalledSaleHandled,
}: {
  sales: Sale[]
  role: Role
  /** Opens the sale in the top-level Edit sale dialog (see App.tsx) — lifted
   *  out of this view entirely so switching StockFlow tabs mid-edit doesn't
   *  tear the edit down; see SaleEditDialog's own doc comment. */
  onEditSale: (sale: Sale) => void
  recalledSale?: Sale | null
  onRecalledSaleHandled?: () => void
}) {
  const [range, setRange] = useState<Range>('7d')
  const [viewingSale, setViewingSale] = useState<Sale | null>(null)
  const isManager = role === 'manager'

  // Opens straight to the scanned sale's receipt, bypassing the date-range
  // filter below entirely — `viewingSale` doesn't depend on `inRange`, so a
  // sale from months ago pops up just as readily as one from today.
  useEffect(() => {
    if (!recalledSale) return
    setViewingSale(recalledSale)
    onRecalledSaleHandled?.()
  }, [recalledSale, onRecalledSaleHandled])

  const inRange = useMemo(() => salesSince(sales, rangeStart(range)), [sales, range])
  const summary = useMemo(() => summariseSales(inRange), [inRange])
  const byChannel = useMemo(() => breakdownByChannel(inRange), [inRange])
  const byPayment = useMemo(() => breakdownByPaymentMethod(inRange), [inRange])
  const byProduct = useMemo(() => breakdownByProduct(inRange), [inRange])

  return (
    <>
      <div className="toolbar">
        <div className="channel-picker" role="group" aria-label="Date range">
          {(Object.keys(RANGE_LABELS) as Range[]).map((value) => (
            <button
              key={value}
              type="button"
              className={`button chip-button ${range === value ? 'chip-button-active' : ''}`}
              aria-pressed={range === value}
              onClick={() => setRange(value)}
            >
              {RANGE_LABELS[value]}
            </button>
          ))}
        </div>
        {isManager && (
          <div className="toolbar-actions">
            <button
              type="button"
              className="button"
              onClick={() => downloadCsv(timestampedFilename('sales'), salesToCsv(inRange))}
            >
              Export sales CSV
            </button>
          </div>
        )}
      </div>

      <section className="stats" aria-label="Profit and loss summary">
        <div className="stat" data-testid="pl-revenue">
          <span className="stat-value">{summary.revenue.toFixed(2)}</span>
          <span className="stat-label">Revenue</span>
        </div>
        {isManager && (
          <div className="stat" data-testid="pl-cost">
            <span className="stat-value">{summary.cost.toFixed(2)}</span>
            <span className="stat-label">Cost of goods</span>
          </div>
        )}
        {isManager && (
          <div className="stat" data-testid="pl-profit">
            <span className="stat-value">{summary.profit.toFixed(2)}</span>
            <span className="stat-label">Profit</span>
          </div>
        )}
        <div className="stat" data-testid="pl-count">
          <span className="stat-value">{formatNumber(summary.saleCount)}</span>
          <span className="stat-label">Sales ({formatNumber(summary.itemsSold)} items)</span>
        </div>
      </section>

      {inRange.length === 0 ? (
        <p className="empty">No sales in this range yet.</p>
      ) : (
        <>
          <div className="field-row">
            <section className="panel">
              <h3>By channel</h3>
              <ul className="plain-list">
                {byChannel.map((row) => (
                  <li key={row.key} className="breakdown-row">
                    <span>{row.key}</span>
                    <span className="mono">{row.revenue.toFixed(2)}</span>
                    {isManager && <span className="muted">profit {row.profit.toFixed(2)}</span>}
                  </li>
                ))}
              </ul>
            </section>
            <section className="panel">
              <h3>By payment method</h3>
              <ul className="plain-list">
                {byPayment.map((row) => (
                  <li key={row.key} className="breakdown-row">
                    <span>{PAYMENT_METHOD_LABELS[row.key as keyof typeof PAYMENT_METHOD_LABELS] ?? row.key}</span>
                    <span className="mono">{row.revenue.toFixed(2)}</span>
                    {isManager && <span className="muted">profit {row.profit.toFixed(2)}</span>}
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <section className="panel">
            <h3>Top products</h3>
            <ul className="plain-list">
              {byProduct.map((row) => (
                <li key={row.sku || row.name} className="breakdown-row" data-testid="product-breakdown-row">
                  <span>
                    {row.name} <span className="mono muted">{row.sku}</span>
                  </span>
                  <span className="mono">{formatNumber(row.unitsSold)} sold</span>
                  <span className="muted">
                    revenue {row.revenue.toFixed(2)}
                    {isManager && ` · profit ${row.profit.toFixed(2)}`}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <ul className="plain-list history-list">
            {inRange.map((sale) => (
              <li key={sale.id} className="history-row" data-testid="sale-row">
                <div className="history-main">
                  <span className="history-product">{sale.channel || 'Unspecified'}</span>
                  <span className="badge">{PAYMENT_METHOD_LABELS[sale.paymentMethod]}</span>
                  {sale.updatedAt && <span className="badge">Edited</span>}
                </div>
                <div className="history-numbers">
                  <span className="mono">{sale.subtotal.toFixed(2)}</span>
                  {isManager && <span className="muted">profit {sale.profit.toFixed(2)}</span>}
                </div>
                <div className="history-meta">
                  <span className="muted">{formatDateTime(sale.createdAt)}</span>
                  <span className="reason">
                    {sale.lines.map((line) => `${line.quantity}x ${line.sku}`).join(', ')}
                  </span>
                </div>
                <div className="dialog-actions">
                  <button
                    type="button"
                    className="button button-ghost"
                    onClick={() => setViewingSale(sale)}
                  >
                    View receipt
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {viewingSale && (
        <ReceiptDialog
          sale={viewingSale}
          isManager={isManager}
          onClose={() => setViewingSale(null)}
          onEdit={() => {
            onEditSale(viewingSale)
            setViewingSale(null)
          }}
        />
      )}
    </>
  )
}

export function HistoryScreen({
  movements,
  products,
  sales,
  activity,
  role,
  onEditSale,
  recalledSale,
  onRecalledSaleHandled,
}: HistoryScreenProps) {
  const [mode, setMode] = useState<Mode>('movements')
  const isManager = role === 'manager'

  // A scanned receipt code can arrive while this screen is showing stock
  // movements or activity, not sales — switch over so SalesView is actually
  // mounted to receive `recalledSale` below.
  useEffect(() => {
    if (recalledSale) setMode('sales')
  }, [recalledSale])

  // The Activity tab is manager-only (see ActivityView's own doc comment) —
  // never leave a non-manager sitting on it, e.g. if their role changes
  // after this screen already mounted.
  useEffect(() => {
    if (!isManager && mode === 'activity') setMode('movements')
  }, [isManager, mode])

  return (
    <div className="screen">
      <div className="channel-picker">
        <button
          type="button"
          className={`button chip-button ${mode === 'movements' ? 'chip-button-active' : ''}`}
          aria-pressed={mode === 'movements'}
          onClick={() => setMode('movements')}
        >
          Stock movements
        </button>
        <button
          type="button"
          className={`button chip-button ${mode === 'sales' ? 'chip-button-active' : ''}`}
          aria-pressed={mode === 'sales'}
          onClick={() => setMode('sales')}
        >
          Sales
        </button>
        {isManager && (
          <button
            type="button"
            className={`button chip-button ${mode === 'activity' ? 'chip-button-active' : ''}`}
            aria-pressed={mode === 'activity'}
            onClick={() => setMode('activity')}
          >
            Activity
          </button>
        )}
      </div>

      {mode === 'movements' && <MovementsView movements={movements} products={products} />}
      {mode === 'sales' && (
        <SalesView
          sales={sales}
          role={role}
          onEditSale={onEditSale}
          recalledSale={recalledSale}
          onRecalledSaleHandled={onRecalledSaleHandled}
        />
      )}
      {isManager && mode === 'activity' && <ActivityView activity={activity} />}
    </div>
  )
}
