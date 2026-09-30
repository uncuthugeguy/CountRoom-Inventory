import { paymentMethodLabel } from '../../domain/paymentMethods'
import { caseItems, caseStatus } from '../../domain/returns'
import { RETURN_STATUS_LABELS, goodwillTypeLabel, type ReturnCase, type Sale } from '../../domain/types'
import { formatCurrency, formatDateTime } from '../format'
import { ScanCode } from './ScanCode'

/**
 * The customer-facing returns receipt — hidden on screen, shown only when
 * printing (`.receipt` in styles.css). CountRoom Register prints the same
 * layout (apps/register/src/components/ReturnReceipt.tsx): what came back
 * (or is expected back, while a staged return is still open), anything sent
 * out as a replacement, the refund/goodwill given, and the returns-receipt
 * number as a scannable barcode so it can be looked up again in either app.
 * Nothing internal (costs, write-offs, return postage) goes on it.
 */
export function ReturnReceipt({ rc, sale }: { rc: ReturnCase; sale?: Sale }) {
  const status = caseStatus(rc)
  const items = caseItems(rc)
  const awaitingItem = status === 'awaiting_item'
  return (
    <div className="receipt" aria-hidden="true" data-testid="refund-receipt">
      <h2>{rc.refundAmount > 0 ? 'Refund receipt' : 'Returns receipt'}</h2>
      <p>{formatDateTime(rc.completedAt ?? rc.updatedAt ?? rc.createdAt)}</p>
      {rc.receiptRef && <p>Return no. {rc.receiptRef}</p>}
      {status !== 'completed' && <p>Status: {RETURN_STATUS_LABELS[status]}</p>}
      {rc.customerRef && <p>Customer: {rc.customerRef}</p>}
      {sale?.orderNumber && <p>Original order: {sale.orderNumber}</p>}
      {!sale?.orderNumber && sale?.clientRef && <p>Original receipt: {sale.clientRef}</p>}
      {!sale?.orderNumber && !sale?.clientRef && sale && <p>Original sale: {formatDateTime(sale.createdAt)}</p>}
      {rc.channel && <p>{rc.channel}</p>}
      {items.length > 0 && (
        <>
          <p>
            <strong>{awaitingItem ? 'Items expected back' : 'Items returned'}</strong>
          </p>
          <table className="receipt-lines">
            <tbody>
              {items.map((line, i) => (
                <tr key={`${line.productId}-${i}`}>
                  <td>
                    {line.quantity} × {line.name}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {rc.replacementLines.length > 0 && (
        <>
          <p>
            <strong>Replacement sent</strong>
          </p>
          <table className="receipt-lines">
            <tbody>
              {rc.replacementLines.map((line) => (
                <tr key={line.id}>
                  <td>
                    {line.quantity} × {line.name}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {rc.reason && <p>Reason: {rc.reason}</p>}
      {rc.goodwillValue > 0 && (
        <p>
          {rc.goodwillType ? goodwillTypeLabel(rc.goodwillType) : 'Goodwill'}: {formatCurrency(rc.goodwillValue)}
        </p>
      )}
      {rc.refundAmount > 0 && (
        <p className="receipt-total">
          Refunded: {formatCurrency(rc.refundAmount)}
          {rc.refundMethod ? ` to ${paymentMethodLabel(rc.refundMethod)}` : ''}
        </p>
      )}
      {rc.receiptRef && (
        <div className="receipt-scan">
          <ScanCode value={rc.receiptRef} format="code128" size={260} />
          <p>{rc.receiptRef}</p>
        </div>
      )}
      <p>Thank you.</p>
    </div>
  )
}
