import { useId, useMemo, useState, type FormEvent } from 'react'
import type { Role } from '../../data/repository'
import { searchProducts } from '../../domain/inventory'
import {
  cartHasIssues,
  cartLineIssue,
  cartTotals,
  checkOrderTotal,
  EMPTY_SALE_FEES_DRAFT,
  resolveSaleFeesDraft,
  saleFeeTotal,
  type Cart,
  type SaleFeesDraft,
} from '../../domain/sales'
import {
  PAID_BY_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
  type Product,
  type Result,
  type Sale,
} from '../../domain/types'
import { CameraScanner } from '../components/CameraScanner'
import { PrintPortal } from '../components/PrintPortal'
import { SaleFeesFields } from '../components/SaleFeesFields'
import { ScanCode } from '../components/ScanCode'
import type { StartCameraScan } from '../../scanner/cameraScanner'
import { formatCurrency, formatDateTime, formatNumber } from '../format'

export interface CheckoutScreenProps {
  products: Product[]
  cart: Cart
  role: Role
  /** User-managed list of sale channels — see Settings. */
  channels: string[]
  /** The most recently completed sale, shown as a receipt-style confirmation. */
  lastSale: Sale | null
  onAddByCode: (code: string) => void
  onAddProduct: (product: Product) => void
  onSetQuantity: (productId: string, quantity: number) => void
  onSetPrice: (productId: string, unitPrice: number) => void
  onRemove: (productId: string) => void
  onAddChannel: (name: string) => void
  onCheckout: (channel: string, paymentMethod: PaymentMethod, fees: SaleFeesDraft) => Promise<Result<Sale>>
  /** Injected in tests; the component otherwise uses the real camera. */
  startCamera?: StartCameraScan
}

export function CheckoutScreen({
  products,
  cart,
  role,
  channels,
  lastSale,
  onAddByCode,
  onAddProduct,
  onSetQuantity,
  onSetPrice,
  onRemove,
  onAddChannel,
  onCheckout,
  startCamera,
}: CheckoutScreenProps) {
  const manualId = useId()
  const searchId = useId()
  const newChannelId = useId()
  const cashId = useId()

  const [manual, setManual] = useState('')
  const [query, setQuery] = useState('')
  const [channel, setChannel] = useState('')
  const [newChannel, setNewChannel] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [cashReceived, setCashReceived] = useState('')
  const [fees, setFees] = useState<SaleFeesDraft>(EMPTY_SALE_FEES_DRAFT)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Cash tendered/change isn't part of the Sale record — it's a till
  // calculation, kept here purely to show on the receipt right after
  // checkout. Cleared whenever a new sale starts.
  const [lastSaleCash, setLastSaleCash] = useState<{ tendered: number; change: number } | null>(
    null,
  )

  const totals = cartTotals(cart)
  const hasIssues = cartHasIssues(cart)
  const resolvedFees = resolveSaleFeesDraft(fees)
  const feeTotal = saleFeeTotal(resolvedFees)
  const netProfit = totals.profit - feeTotal
  const orderTotalCheck = checkOrderTotal(totals.subtotal, resolvedFees)

  const tendered = Number(cashReceived)
  const tenderedValid = cashReceived.trim() !== '' && Number.isFinite(tendered)
  const change = tenderedValid ? tendered - totals.subtotal : null

  const matches = useMemo(() => {
    if (!query.trim()) return []
    return searchProducts(products, query).slice(0, 6)
  }, [products, query])

  const submitManual = (event: FormEvent) => {
    event.preventDefault()
    const code = manual.trim()
    if (!code) return
    onAddByCode(code)
    setManual('')
  }

  const addFromSearch = (product: Product) => {
    onAddProduct(product)
    setQuery('')
  }

  const submitNewChannel = (event: FormEvent) => {
    event.preventDefault()
    const name = newChannel.trim()
    if (!name) return
    onAddChannel(name)
    setChannel(name)
    setNewChannel('')
  }

  const checkout = async () => {
    setError(null)
    if (cart.length === 0) {
      setError('Add at least one item to the sale.')
      return
    }
    if (hasIssues) {
      setError('Fix the stock issues below before checking out.')
      return
    }
    if (!channel) {
      setError('Choose where this was sold.')
      return
    }
    if (paymentMethod === 'cash') {
      if (!tenderedValid) {
        setError('Enter the cash received.')
        return
      }
      if (tendered < totals.subtotal) {
        setError('Cash received is less than the total.')
        return
      }
    }

    setSaving(true)
    const result = await onCheckout(channel, paymentMethod, fees)
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setLastSaleCash(paymentMethod === 'cash' ? { tendered, change: tendered - totals.subtotal } : null)
    setChannel('')
    setPaymentMethod('cash')
    setCashReceived('')
    setFees(EMPTY_SALE_FEES_DRAFT)
  }

  return (
    <div className="screen">
      <section className="panel">
        <h2>Add to sale</h2>
        <p className="muted">
          Scan a barcode or SKU, or search by name below, to add an item to this sale.
        </p>
        <CameraScanner onDecode={onAddByCode} start={startCamera} />
      </section>

      <section className="panel">
        <form className="toolbar" onSubmit={submitManual}>
          <div className="field field-grow">
            <label htmlFor={manualId}>Enter a barcode or SKU</label>
            <input
              id={manualId}
              value={manual}
              autoComplete="off"
              placeholder="5012345678900 or BLT-M6"
              onChange={(event) => setManual(event.target.value)}
            />
          </div>
          <div className="toolbar-actions">
            <button type="submit" className="button button-primary">
              Add to sale
            </button>
          </div>
        </form>

        <div className="field checkout-search-field">
          <label htmlFor={searchId}>Or search by name</label>
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
                <button type="button" className="button button-ghost" onClick={() => addFromSearch(product)}>
                  Add
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>Sale</h2>
        {cart.length === 0 ? (
          <p className="empty">Nothing added yet. Scan or search above to start a sale.</p>
        ) : (
          <ul className="plain-list cart-list">
            {cart.map((line) => {
              const issue = cartLineIssue(line)
              return (
                <li key={line.product.id} className="cart-row" data-testid="cart-row">
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
                          // A blank field mid-edit (e.g. clearing "2" before typing "9")
                          // must not read as zero and delete the line — only the
                          // Remove button does that. Ignore it and clamp to at least 1.
                          const parsed = Number(e.target.value)
                          if (!Number.isFinite(parsed)) return
                          onSetQuantity(line.product.id, Math.max(1, Math.trunc(parsed)))
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
                        onChange={(e) => onSetPrice(line.product.id, Number(e.target.value) || 0)}
                      />
                    </label>
                    <span className="cart-line-total">{formatCurrency((line.unitPrice * line.quantity))}</span>
                    <button
                      type="button"
                      className="button button-ghost"
                      aria-label={`Remove ${line.product.name} from sale`}
                      onClick={() => onRemove(line.product.id)}
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
          <div className="cart-totals" data-testid="cart-totals">
            <span>{formatNumber(totals.itemCount)} items</span>
            <span>Subtotal: {formatCurrency(totals.subtotal)}</span>
            {role === 'manager' && <span>Est. profit: {formatCurrency(netProfit)}</span>}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Sold on</h2>
        <div className="channel-picker">
          {channels.map((name) => (
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
        <form className="toolbar" onSubmit={submitNewChannel}>
          <div className="field field-grow">
            <label htmlFor={newChannelId}>Add a new channel</label>
            <input
              id={newChannelId}
              value={newChannel}
              autoComplete="off"
              placeholder="Where else do you sell?"
              onChange={(event) => setNewChannel(event.target.value)}
            />
          </div>
          <div className="toolbar-actions">
            <button type="submit" className="button">
              Add channel
            </button>
          </div>
        </form>
      </section>

      {role === 'manager' && (
        <section className="panel">
          <SaleFeesFields value={fees} onChange={setFees} />
          {orderTotalCheck && (
            <p
              className={`order-total-check ${orderTotalCheck.matches ? '' : 'order-total-check-mismatch'}`}
              data-testid="order-total-check"
            >
              {orderTotalCheck.matches
                ? `Matches your order total (${formatCurrency(orderTotalCheck.entered)}).`
                : `You've itemised ${formatCurrency(orderTotalCheck.itemised)}, but entered an order total of ${formatCurrency(orderTotalCheck.entered)} — ${
                    orderTotalCheck.difference > 0
                      ? `you're ${formatCurrency(orderTotalCheck.difference)} short. Check you haven't missed a fee.`
                      : `that's ${formatCurrency(Math.abs(orderTotalCheck.difference))} more than the order total. Check the item price above isn't already including a fee you've also entered below.`
                  }`}
            </p>
          )}
        </section>
      )}

      <section className="panel">
        <h2>Payment method</h2>
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

        {paymentMethod === 'cash' && (
          <div className="field-row cash-row">
            <div className="field">
              <label htmlFor={cashId}>Cash received</label>
              <input
                id={cashId}
                type="number"
                min={0}
                step={0.01}
                inputMode="decimal"
                value={cashReceived}
                placeholder={formatCurrency(totals.subtotal)}
                onChange={(event) => setCashReceived(event.target.value)}
              />
            </div>
            <div className="field">
              <span>Change due</span>
              <p
                className={`change-due ${change !== null && change < 0 ? 'change-due-short' : ''}`}
                data-testid="change-due"
              >
                {change === null
                  ? '—'
                  : change < 0
                    ? `Short ${formatCurrency(Math.abs(change))}`
                    : formatCurrency(change)}
              </p>
            </div>
          </div>
        )}
      </section>

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        className="button button-primary checkout-submit"
        disabled={saving || cart.length === 0}
        onClick={checkout}
      >
        {saving ? 'Completing sale…' : `Complete sale — ${formatCurrency(totals.subtotal)}`}
      </button>

      {lastSale && (
        <section className="panel" data-testid="last-sale">
          <header className="panel-header">
            <h2>Last sale</h2>
            <span className="mono">{lastSale.channel}</span>
          </header>
          <p className="scan-quantity">
            <span className="quantity">{formatCurrency(lastSale.subtotal)}</span>
            <span className="quantity-caption">
              {PAYMENT_METHOD_LABELS[lastSale.paymentMethod]}
              {role === 'manager' && ` · profit ${formatCurrency(lastSale.profit)}`}
            </span>
          </p>
          {lastSaleCash && (
            <p className="muted">
              Cash received {formatCurrency(lastSaleCash.tendered)} · change {formatCurrency(lastSaleCash.change)}
            </p>
          )}

          {role === 'manager' &&
            ((lastSale.buyerProtectionFee ?? 0) > 0 ||
              (lastSale.deliveryCost ?? 0) > 0 ||
              (lastSale.vat ?? 0) > 0 ||
              (lastSale.advertisingCost ?? 0) > 0) && (
              <p className="muted" data-testid="last-sale-fees">
                {(lastSale.buyerProtectionFee ?? 0) > 0 &&
                  `Buyer protection ${formatCurrency(lastSale.buyerProtectionFee!)} (${PAID_BY_LABELS[lastSale.buyerProtectionFeePaidBy ?? 'seller']} paid) · `}
                {(lastSale.deliveryCost ?? 0) > 0 &&
                  `Delivery ${formatCurrency(lastSale.deliveryCost!)} (${PAID_BY_LABELS[lastSale.deliveryPaidBy ?? 'seller']} paid) · `}
                {(lastSale.vat ?? 0) > 0 && `VAT ${formatCurrency(lastSale.vat!)} · `}
                {(lastSale.advertisingCost ?? 0) > 0 && `Advertising ${formatCurrency(lastSale.advertisingCost!)}`}
              </p>
            )}

          {/* The full itemised receipt, right here on screen — not just the
              print-only copy below, which you'd otherwise only ever see by
              opening the print dialog. */}
          <table className="receipt-lines">
            <tbody>
              {lastSale.lines.map((line) => (
                <tr key={line.id}>
                  <td>
                    {line.quantity} × {line.name} ({line.sku})
                  </td>
                  <td className="receipt-amount">{formatCurrency(line.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="receipt-total">Total: {formatCurrency(lastSale.subtotal)}</p>

          <div className="dialog-actions">
            <button type="button" className="button" onClick={() => window.print()}>
              Print receipt
            </button>
          </div>
        </section>
      )}

      {/* Portalled onto <body> and off-screen except when printing —
          @media print in styles.css hides the rest of the app and shows
          only this block. See PrintPortal for why it's a portal, not just
          nested here: nesting it caused printing to spit out several blank
          pages alongside the real one. */}
      {lastSale && (
        <PrintPortal>
          <div className="receipt" aria-hidden="true" data-testid="print-receipt">
            <h2>Receipt</h2>
            <p>{formatDateTime(lastSale.createdAt)}</p>
            <p>Sold via {lastSale.channel || 'Unspecified'}</p>
            <table className="receipt-lines">
              <tbody>
                {lastSale.lines.map((line) => (
                  <tr key={line.id}>
                    <td>
                      {line.quantity} × {line.name} ({line.sku})
                    </td>
                    <td className="receipt-amount">{formatCurrency(line.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="receipt-total">Total: {formatCurrency(lastSale.subtotal)}</p>
            <p>Payment: {PAYMENT_METHOD_LABELS[lastSale.paymentMethod]}</p>
            {lastSaleCash && (
              <>
                <p>Cash received: {formatCurrency(lastSaleCash.tendered)}</p>
                <p>Change given: {formatCurrency(lastSaleCash.change)}</p>
              </>
            )}

            {/* Manager-only, matching every other place this sale's fees
                and profit show up on screen — an employee's printed copy
                stays limited to what they can already see at checkout. */}
            {role === 'manager' &&
              ((lastSale.buyerProtectionFee ?? 0) > 0 ||
                (lastSale.deliveryCost ?? 0) > 0 ||
                (lastSale.vat ?? 0) > 0 ||
                (lastSale.advertisingCost ?? 0) > 0 ||
                (lastSale.orderTotal !== null && lastSale.orderTotal !== undefined)) && (
                <>
                  <p className="receipt-total">Fees</p>
                  {(lastSale.buyerProtectionFee ?? 0) > 0 && (
                    <p>
                      Buyer protection: {formatCurrency(lastSale.buyerProtectionFee!)} (
                      {PAID_BY_LABELS[lastSale.buyerProtectionFeePaidBy ?? 'seller']} paid)
                    </p>
                  )}
                  {(lastSale.deliveryCost ?? 0) > 0 && (
                    <p>
                      Delivery: {formatCurrency(lastSale.deliveryCost!)} ({PAID_BY_LABELS[lastSale.deliveryPaidBy ?? 'seller']}{' '}
                      paid)
                    </p>
                  )}
                  {(lastSale.vat ?? 0) > 0 && <p>VAT: {formatCurrency(lastSale.vat!)}</p>}
                  {(lastSale.advertisingCost ?? 0) > 0 && <p>Advertising: {formatCurrency(lastSale.advertisingCost!)}</p>}
                  {lastSale.orderTotal !== null && lastSale.orderTotal !== undefined && (
                    <p>Order total: {formatCurrency(lastSale.orderTotal)}</p>
                  )}
                </>
              )}
            {role === 'manager' && <p className="receipt-total">Profit: {formatCurrency(lastSale.profit)}</p>}

            {/* A scannable code for this exact sale — scan it back in on the
                History screen later (with a camera or a wedge scanner) to
                pull this sale straight back up, no searching required. */}
            <div className="receipt-scan">
              <ScanCode value={lastSale.id} format="qr" size={110} />
              <p>Scan to find this sale in History</p>
            </div>
          </div>
        </PrintPortal>
      )}
    </div>
  )
}
