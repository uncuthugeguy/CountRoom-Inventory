import { useId, useMemo, useState } from 'react'
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
  PAID_BY_LABELS,
  MOVEMENT_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
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
import { formatDateTime, formatDelta, formatNumber } from '../format'

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
 * a dialog and seeded from the sale being edited. */
function SaleEditDialog({
  sale,
  products,
  channels,
  role,
  onClose,
  onSave,
}: {
  sale: Sale
  products: Product[]
  channels: string[]
  role: Role
  onClose: () => void
  onSave: (id: string, input: SaleInput) => Promise<Result<Sale>>
}) {
  const searchId = useId()

  const initialCart = useMemo(() => buildEditCart(sale, products), [sale, products])
  const droppedCount = sale.lines.length - initialCart.length

  const [cart, setCart] = useState<Cart>(initialCart)
  const [channel, setChannel] = useState(sale.channel)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(sale.paymentMethod)
  const [fees, setFees] = useState<SaleFeesDraft>(() => saleFeesDraftFromSale(sale))
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Keep the sale's original channel selectable even if it's since been
  // removed from Settings' managed list — otherwise reopening an old sale
  // would silently strand its channel with nothing selected.
  const channelOptions = channels.includes(channel) ? channels : [channel, ...channels].filter(Boolean)

  const totals = cartTotals(cart)
  const hasIssues = editCartHasIssues(cart, sale)
  const netProfit = totals.profit - saleFeeTotal(resolveSaleFeesDraft(fees))

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
    onClose()
  }

  return (
    <Dialog title="Edit sale" onClose={onClose}>
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
                    <span>Price</span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      inputMode="decimal"
                      value={line.unitPrice}
                      aria-label={`Price for ${line.product.name}`}
                      disabled={role !== 'manager'}
                      title={role !== 'manager' ? 'Only a manager can change the sale price' : undefined}
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

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <div className="dialog-actions">
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
  role: Role
  /** User-managed list of sale channels — see Settings. */
  channels: string[]
  onUpdateSale: (id: string, input: SaleInput) => Promise<Result<Sale>>
}

type Mode = 'movements' | 'sales'
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

function SalesView({
  sales,
  products,
  role,
  channels,
  onUpdateSale,
}: {
  sales: Sale[]
  products: Product[]
  role: Role
  channels: string[]
  onUpdateSale: (id: string, input: SaleInput) => Promise<Result<Sale>>
}) {
  const [range, setRange] = useState<Range>('7d')
  const [viewingSale, setViewingSale] = useState<Sale | null>(null)
  const [editingSale, setEditingSale] = useState<Sale | null>(null)
  const isManager = role === 'manager'

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
            setEditingSale(viewingSale)
            setViewingSale(null)
          }}
        />
      )}

      {editingSale && (
        <SaleEditDialog
          sale={editingSale}
          products={products}
          channels={channels}
          role={role}
          onClose={() => setEditingSale(null)}
          onSave={onUpdateSale}
        />
      )}
    </>
  )
}

export function HistoryScreen({ movements, products, sales, role, channels, onUpdateSale }: HistoryScreenProps) {
  const [mode, setMode] = useState<Mode>('movements')

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
      </div>

      {mode === 'movements' ? (
        <MovementsView movements={movements} products={products} />
      ) : (
        <SalesView sales={sales} products={products} role={role} channels={channels} onUpdateSale={onUpdateSale} />
      )}
    </div>
  )
}
