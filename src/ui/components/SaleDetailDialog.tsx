import { paymentMethodLabel } from '../../domain/paymentMethods'
import { checkOrderTotal } from '../../domain/sales'
import { PAID_BY_LABELS, type Sale } from '../../domain/types'
import { formatCurrency, formatDateTime } from '../format'
import { Dialog } from './Dialog'
import { PrintPortal } from './PrintPortal'

/**
 * Everything about one sale after it's been put through — what sold, at
 * what price, what it cost you, every fee, and what you actually made.
 * Opened from History → Sales ("View details") and from the Dashboard's
 * "Today's sales" list. Cost, fees and profit are manager-only, same as
 * everywhere else in the app. `onEdit` is optional: the Dashboard only
 * views, History can jump straight into editing.
 */
export function SaleDetailDialog({
  sale,
  isManager,
  onClose,
  onEdit,
}: {
  sale: Sale
  isManager: boolean
  onClose: () => void
  onEdit?: () => void
}) {
  const buyerProtection = sale.buyerProtectionFee ?? 0
  const buyerProtectionBy = sale.buyerProtectionFeePaidBy ?? 'seller'
  const delivery = sale.deliveryCost ?? 0
  const deliveryBy = sale.deliveryPaidBy ?? 'seller'
  const vat = sale.vat ?? 0
  const advertising = sale.advertisingCost ?? 0
  const orderTotal = sale.orderTotal ?? null
  const orderCheck = checkOrderTotal(sale.subtotal, {
    buyerProtectionFee: buyerProtection,
    deliveryCost: delivery,
    deliveryPaidBy: deliveryBy,
    vat,
    orderTotal,
  })
  const units = sale.lines.reduce((sum, line) => sum + line.quantity, 0)

  const row = (label: string, value: number, opts: { strong?: boolean; negative?: boolean; testId?: string } = {}) => (
    <tr data-testid={opts.testId}>
      <td>{opts.strong ? <strong>{label}</strong> : label}</td>
      <td className="receipt-amount">
        {opts.strong ? (
          <strong>{formatCurrency(value)}</strong>
        ) : (
          `${opts.negative && value > 0 ? '−' : ''}${formatCurrency(value)}`
        )}
      </td>
    </tr>
  )

  return (
    <Dialog title="Sale details" onClose={onClose}>
      <div className="form" data-testid="sale-detail">
        <p className="muted">
          {formatDateTime(sale.createdAt)}
          {sale.backdated && sale.saleDate ? ` · logged against ${sale.saleDate}` : ''}
        </p>
        {sale.updatedAt && <p className="muted">Last edited {formatDateTime(sale.updatedAt)}</p>}
        {sale.orderNumber && (
          <p>
            Order number <strong className="mono">{sale.orderNumber}</strong>
          </p>
        )}
        <p>
          Sold via <strong>{sale.channel || 'Unspecified'}</strong> · Paid by{' '}
          <strong>{paymentMethodLabel(sale.paymentMethod)}</strong>
        </p>

        <table className="receipt-lines">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Item</th>
              <th className="receipt-amount">Price each</th>
              {isManager && <th className="receipt-amount">Cost each</th>}
              <th className="receipt-amount">Total</th>
              {isManager && <th className="receipt-amount">Profit</th>}
            </tr>
          </thead>
          <tbody>
            {sale.lines.map((line) => (
              <tr key={line.id}>
                <td>
                  {line.quantity} × {line.name}
                  {line.sku ? ` (${line.sku})` : ''}
                </td>
                <td className="receipt-amount">{formatCurrency(line.unitPrice)}</td>
                {isManager && <td className="receipt-amount">{formatCurrency(line.unitCost)}</td>}
                <td className="receipt-amount">{formatCurrency(line.lineTotal)}</td>
                {isManager && <td className="receipt-amount">{formatCurrency(line.lineProfit)}</td>}
              </tr>
            ))}
          </tbody>
        </table>

        <table className="receipt-lines" style={{ maxWidth: '26rem' }}>
          <tbody>
            {row(`Items sold (${units})`, sale.subtotal, { strong: true })}
            {buyerProtection > 0 &&
              row(`Buyer protection (paid by ${PAID_BY_LABELS[buyerProtectionBy].toLowerCase()})`, buyerProtection)}
            {delivery > 0 && row(`Delivery (paid by ${PAID_BY_LABELS[deliveryBy].toLowerCase()})`, delivery)}
            {vat > 0 && row('VAT', vat)}
            {orderTotal !== null && row('Order total (what the buyer paid)', orderTotal)}
          </tbody>
        </table>
        {orderCheck && !orderCheck.matches && (
          <p className="alert" style={{ fontSize: '.9em' }}>
            {`Order total is ${formatCurrency(Math.abs(orderCheck.difference))} ${orderCheck.difference > 0 ? 'more' : 'less'} than the items and fees add up to.`}
          </p>
        )}

        {isManager && (
          <table className="receipt-lines" style={{ maxWidth: '26rem' }} data-testid="sale-detail-profit">
            <tbody>
              {row('Sold for', sale.subtotal)}
              {row('Cost of items', sale.totalCost, { negative: true })}
              {buyerProtectionBy === 'seller' && buyerProtection > 0 && row('Buyer protection', buyerProtection, { negative: true })}
              {deliveryBy === 'seller' && delivery > 0 && row('Delivery', delivery, { negative: true })}
              {vat > 0 && row('VAT', vat, { negative: true })}
              {advertising > 0 && row('Advertising', advertising, { negative: true })}
              {row('Profit', sale.profit, { strong: true, testId: 'sale-detail-profit-total' })}
            </tbody>
          </table>
        )}

        <div className="dialog-actions">
          <button type="button" className="button" onClick={() => window.print()}>
            Print receipt
          </button>
          {isManager && onEdit && (
            <button type="button" className="button" onClick={onEdit}>
              Edit sale
            </button>
          )}
          <button type="button" className="button button-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <PrintPortal>
        <SaleReceipt sale={sale} />
      </PrintPortal>
    </Dialog>
  )
}

/**
 * The customer-facing receipt printed by "Print receipt" — hidden on screen,
 * shown only when printing (see `.receipt` in styles.css). No cost, fee
 * split or profit on it: just what the buyer bought and paid.
 */
export function SaleReceipt({ sale }: { sale: Sale }) {
  const buyerProtection = sale.buyerProtectionFee ?? 0
  const delivery = sale.deliveryCost ?? 0
  const buyerPaidDelivery = (sale.deliveryPaidBy ?? 'seller') === 'buyer' ? delivery : 0
  const vat = sale.vat ?? 0
  const total = sale.orderTotal ?? sale.subtotal + buyerProtection + buyerPaidDelivery + vat
  return (
    <div className="receipt" aria-hidden="true" data-testid="sale-receipt">
      <h2>Receipt</h2>
      <p>{formatDateTime(sale.createdAt)}</p>
      {sale.orderNumber && <p>Order number: {sale.orderNumber}</p>}
      <p>
        {sale.channel || 'Sale'} · {paymentMethodLabel(sale.paymentMethod)}
      </p>
      <table className="receipt-lines">
        <tbody>
          {sale.lines.map((line) => (
            <tr key={line.id}>
              <td>
                {line.quantity} × {line.name}
                {line.quantity > 1 ? ` @ ${formatCurrency(line.unitPrice)}` : ''}
              </td>
              <td className="receipt-amount">{formatCurrency(line.lineTotal)}</td>
            </tr>
          ))}
          <tr>
            <td>Subtotal</td>
            <td className="receipt-amount">{formatCurrency(sale.subtotal)}</td>
          </tr>
          {buyerProtection > 0 && (
            <tr>
              <td>Buyer protection</td>
              <td className="receipt-amount">{formatCurrency(buyerProtection)}</td>
            </tr>
          )}
          {buyerPaidDelivery > 0 && (
            <tr>
              <td>Postage</td>
              <td className="receipt-amount">{formatCurrency(buyerPaidDelivery)}</td>
            </tr>
          )}
          {vat > 0 && (
            <tr>
              <td>VAT</td>
              <td className="receipt-amount">{formatCurrency(vat)}</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="receipt-total">Total paid: {formatCurrency(total)}</p>
      <p>Thank you for your order.</p>
    </div>
  )
}
