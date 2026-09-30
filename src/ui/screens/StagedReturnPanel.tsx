import { useId, useMemo, useState } from 'react'
import { paymentMethodLabel, paymentMethodOptions } from '../../domain/paymentMethods'
import { searchProducts } from '../../domain/inventory'
import {
  addReplacementLine,
  caseStatus,
  removeReplacementLine,
  replacementCartHasIssues,
  replacementLineIssue,
  setReplacementLineQuantity,
  type CompleteReturnInput,
  type ReceivedReturnLine,
  type ReplacementCart,
} from '../../domain/returns'
import {
  GOODWILL_TYPES,
  GOODWILL_TYPE_LABELS,
  RETURN_STATUS_LABELS,
  STOCK_DISPOSITIONS,
  STOCK_DISPOSITION_CHOICE_LABELS,
  type PaymentMethod,
  type Product,
  type ReturnCase,
  type StockDisposition,
} from '../../domain/types'
import { PinDialog } from '../components/PinDialog'
import { formatCurrency, formatDateTime } from '../format'
import type { ReturnFlow } from '../useInventory'

const STAGES = ['1. Label sent', '2. Item arrived', '3. Refund issued'] as const

interface ReceivedRow extends ReceivedReturnLine {
  name: string
  sku: string
  include: boolean
}

/**
 * One return that's part-way through the three stages — the Inventory
 * twin of CountRoom Register's StagedReturnView. Shows where it's up to
 * and the form for the next stage: 2 (the item arrived — inspect first,
 * restock or write off each item) or 3 (refund / goodwill / replacement,
 * or close with no refund). Every step needs a PIN.
 */
export function StagedReturnPanel({
  rc,
  products,
  returnFlow,
  onBack,
  onChanged,
}: {
  rc: ReturnCase
  products: Product[]
  returnFlow: ReturnFlow
  onBack: () => void
  /** Called with the updated case and a short notice after a step saves. */
  onChanged: (updated: ReturnCase | null, notice: string) => void
}) {
  const status = caseStatus(rc)
  const stageIndex = status === 'awaiting_item' ? 1 : 2
  const refundId = useId()
  const goodwillTypeId = useId()
  const goodwillValueId = useId()
  const notesId = useId()
  const replacementSearchId = useId()
  const cancelNoteId = useId()

  // Stage 2 — one row per expected item, defaulting to "Inspect first".
  const [received, setReceived] = useState<ReceivedRow[]>(
    (rc.expectedItems ?? []).map((item) => ({
      productId: item.productId,
      sku: item.sku,
      name: item.name,
      quantity: item.quantity,
      disposition: 'inspect' as StockDisposition,
      include: true,
    })),
  )

  // Stage 3.
  const [refundAmount, setRefundAmount] = useState('')
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>('cash')
  const [goodwillType, setGoodwillType] = useState('')
  const [goodwillValue, setGoodwillValue] = useState('')
  const [notes, setNotes] = useState('')
  const [replacementCart, setReplacementCart] = useState<ReplacementCart>([])
  const [replacementQuery, setReplacementQuery] = useState('')

  const [pinFor, setPinFor] = useState<'receive' | 'complete' | 'cancel' | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [cancelNote, setCancelNote] = useState('Item never arrived')
  const [error, setError] = useState<string | null>(null)

  const receivedLines: ReceivedReturnLine[] = received
    .filter((row) => row.include && row.quantity > 0)
    .map(({ productId, quantity, disposition }) => ({ productId, quantity, disposition }))
  const hasInspect = receivedLines.some((l) => l.disposition === 'inspect')

  const replacementMatches = useMemo(() => {
    if (!replacementQuery.trim()) return []
    return searchProducts(products, replacementQuery)
      .filter((p) => !replacementCart.some((l) => l.product.id === p.id))
      .slice(0, 6)
  }, [products, replacementQuery, replacementCart])

  const refundNumber = refundAmount.trim() === '' ? 0 : Number(refundAmount)
  const goodwillNumber = goodwillType && goodwillValue.trim() !== '' ? Number(goodwillValue) : 0
  const hasRefundOrGoodwill = refundNumber > 0 || goodwillNumber > 0

  const completeInput = (): CompleteReturnInput => ({
    refundAmount: refundNumber > 0 ? refundNumber : undefined,
    refundMethod: refundNumber > 0 ? refundMethod : undefined,
    goodwillType: goodwillNumber > 0 ? goodwillType : undefined,
    goodwillValue: goodwillNumber > 0 ? goodwillNumber : undefined,
    notes: notes.trim() || undefined,
    replacementLines: replacementCart.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
  })

  const askToComplete = () => {
    setError(null)
    if (!Number.isFinite(refundNumber) || refundNumber < 0) return setError('Refund amount must be zero or greater.')
    if (!Number.isFinite(goodwillNumber) || goodwillNumber < 0) return setError('Goodwill value must be zero or greater.')
    if (replacementCartHasIssues(replacementCart)) return setError('Fix the stock issues below before saving.')
    setPinFor('complete')
  }

  const expected = rc.expectedItems ?? []

  return (
    <section className="panel" data-testid="staged-return">
      <button type="button" className="button button-ghost" onClick={onBack}>
        ← Back to returns
      </button>

      <div className="channel-picker" aria-label="Return stages">
        {STAGES.map((title, i) => (
          <span
            key={title}
            className={`button chip-button ${i === stageIndex ? 'chip-button-active' : ''}`}
            aria-current={i === stageIndex ? 'step' : undefined}
            style={{ opacity: i > stageIndex ? 0.5 : 1, cursor: 'default' }}
          >
            {i < stageIndex ? '✓ ' : ''}
            {title}
          </span>
        ))}
      </div>

      <h2>{RETURN_STATUS_LABELS[status]}</h2>
      <p className="muted">
        Label sent {formatDateTime(rc.labelSentAt ?? rc.createdAt)}
        {rc.itemReceivedAt && ` · Item arrived ${formatDateTime(rc.itemReceivedAt)}`}
        {(rc.returnPostageCost ?? 0) > 0 && ` · Label cost ${formatCurrency(rc.returnPostageCost ?? 0)}`}
      </p>
      {rc.receiptRef && <p className="muted mono">Return no. {rc.receiptRef}</p>}
      {rc.customerRef && <p className="muted">Customer: {rc.customerRef}</p>}
      {rc.reason && <p className="muted">Reason: {rc.reason}</p>}
      {rc.notes && <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{rc.notes}</p>}
      {expected.length > 0 && (
        <p className="muted">Expected back: {expected.map((i) => `${i.quantity} × ${i.name}`).join(', ')}</p>
      )}

      {status === 'awaiting_item' && (
        <>
          <h3>Stage 2 — has the item arrived?</h3>
          <p className="muted">
            Tick what came back and choose what happens to it. "Inspect first" keeps it out of stock until someone
            checks it (it then shows under Awaiting inspection); "Restock" adds it straight back.
          </p>
          <ul className="plain-list cart-list">
            {received.map((row, idx) => (
              <li key={row.productId} className="cart-row" data-testid="received-row">
                <label className="cart-identity">
                  <input
                    type="checkbox"
                    checked={row.include}
                    aria-label={`${row.name} arrived`}
                    onChange={(e) =>
                      setReceived((rows) => rows.map((r, i) => (i === idx ? { ...r, include: e.target.checked } : r)))
                    }
                  />{' '}
                  <span className="product-name">{row.name}</span>
                  <span className="mono muted">{row.sku}</span>
                </label>
                <div className="cart-fields">
                  <label className="cart-field">
                    <span>Qty</span>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      inputMode="numeric"
                      value={row.quantity}
                      disabled={!row.include}
                      aria-label={`Quantity arrived for ${row.name}`}
                      onChange={(e) => {
                        const parsed = Math.max(1, Math.trunc(Number(e.target.value) || 1))
                        setReceived((rows) => rows.map((r, i) => (i === idx ? { ...r, quantity: parsed } : r)))
                      }}
                    />
                  </label>
                  <div className="channel-picker" role="group" aria-label={`What happens to ${row.name}`}>
                    {STOCK_DISPOSITIONS.map((d) => (
                      <button
                        key={d}
                        type="button"
                        disabled={!row.include}
                        className={`button chip-button ${row.disposition === d ? 'chip-button-active' : ''}`}
                        aria-pressed={row.disposition === d}
                        onClick={() =>
                          setReceived((rows) => rows.map((r, i) => (i === idx ? { ...r, disposition: d } : r)))
                        }
                      >
                        {STOCK_DISPOSITION_CHOICE_LABELS[d]}
                      </button>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="dialog-actions">
            <button
              type="button"
              className="button button-primary"
              disabled={receivedLines.length === 0}
              onClick={() => setPinFor('receive')}
            >
              Item arrived (PIN)
            </button>
            <button type="button" className="button" onClick={() => setCancelling((c) => !c)}>
              Cancel return…
            </button>
          </div>
          {cancelling && (
            <div className="panel">
              <p className="muted">Cancel this return? The label cost stays recorded.</p>
              <div className="field">
                <label htmlFor={cancelNoteId}>Note (optional)</label>
                <input id={cancelNoteId} value={cancelNote} onChange={(e) => setCancelNote(e.target.value)} />
              </div>
              <button type="button" className="button" onClick={() => setPinFor('cancel')}>
                Cancel return (PIN)
              </button>
            </div>
          )}
        </>
      )}

      {status === 'awaiting_refund' && (
        <>
          <h3>Stage 3 — refund</h3>
          {rc.returnLines.length > 0 && (
            <p className="muted">
              Came back: {rc.returnLines.map((l) => `${l.quantity} × ${l.name}`).join(', ')}
            </p>
          )}
          <div className="field-row">
            <div className="field">
              <label htmlFor={refundId}>Refund amount</label>
              <input
                id={refundId}
                type="number"
                min={0}
                step={0.01}
                inputMode="decimal"
                placeholder="0.00"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
              />
            </div>
            <div className="field">
              <span>Refund method</span>
              <div className="channel-picker">
                {paymentMethodOptions(refundMethod).map((method) => (
                  <button
                    key={method}
                    type="button"
                    className={`button chip-button ${refundMethod === method ? 'chip-button-active' : ''}`}
                    aria-pressed={refundMethod === method}
                    onClick={() => setRefundMethod(method)}
                  >
                    {paymentMethodLabel(method)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor={goodwillTypeId}>Goodwill type</label>
              <select id={goodwillTypeId} value={goodwillType} onChange={(e) => setGoodwillType(e.target.value)}>
                <option value="">None</option>
                {GOODWILL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {GOODWILL_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={goodwillValueId}>Goodwill value</label>
              <input
                id={goodwillValueId}
                type="number"
                min={0}
                step={0.01}
                inputMode="decimal"
                placeholder="0.00"
                disabled={goodwillType === ''}
                value={goodwillValue}
                onChange={(e) => setGoodwillValue(e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor={replacementSearchId}>Replacement items (optional)</label>
            <input
              id={replacementSearchId}
              type="search"
              autoComplete="off"
              placeholder="Search or scan to send a replacement item…"
              value={replacementQuery}
              onChange={(e) => setReplacementQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && replacementMatches.length === 1) {
                  e.preventDefault()
                  setReplacementCart((c) => addReplacementLine(c, replacementMatches[0]))
                  setReplacementQuery('')
                }
              }}
            />
          </div>
          {replacementMatches.length > 0 && (
            <ul className="plain-list checkout-search-results">
              {replacementMatches.map((product) => (
                <li key={product.id} className="checkout-search-row">
                  <span className="checkout-search-name">{product.name}</span>
                  <span className="mono muted">
                    {product.sku} · {product.quantity} in stock
                  </span>
                  <button
                    type="button"
                    className="button button-ghost"
                    onClick={() => {
                      setReplacementCart((c) => addReplacementLine(c, product))
                      setReplacementQuery('')
                    }}
                  >
                    Add
                  </button>
                </li>
              ))}
            </ul>
          )}
          {replacementCart.length > 0 && (
            <ul className="plain-list cart-list">
              {replacementCart.map((line) => {
                const issue = replacementLineIssue(line)
                return (
                  <li key={line.product.id} className="cart-row">
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
                          value={line.quantity}
                          aria-label={`Replacement quantity for ${line.product.name}`}
                          onChange={(e) =>
                            setReplacementCart((c) =>
                              setReplacementLineQuantity(c, line.product.id, Math.max(1, Math.trunc(Number(e.target.value) || 1))),
                            )
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="button button-ghost"
                        onClick={() => setReplacementCart((c) => removeReplacementLine(c, line.product.id))}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="field">
            <label htmlFor={notesId}>Notes (optional)</label>
            <textarea id={notesId} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="button button-primary checkout-submit" onClick={askToComplete}>
            {hasRefundOrGoodwill ? 'Issue refund & complete (PIN)' : 'Complete with no refund (PIN)'}
          </button>
        </>
      )}

      {pinFor === 'receive' && (
        <PinDialog
          title="Item arrived"
          message={
            hasInspect
              ? 'Enter a PIN. Items marked Inspect first stay out of stock until they’re inspected.'
              : 'Enter a PIN to mark the item as arrived.'
          }
          confirmLabel="Approve"
          onSubmit={async (pin) => {
            const result = await returnFlow.receive(rc.id, receivedLines, pin)
            if (result.ok) onChanged(result.value, 'Item marked as arrived — ready for the refund stage.')
            return result
          }}
          onDone={() => setPinFor(null)}
          onCancel={() => setPinFor(null)}
        />
      )}
      {pinFor === 'cancel' && (
        <PinDialog
          title="Cancel return"
          message="Enter a PIN to cancel this return."
          confirmLabel="Cancel return"
          onSubmit={async (pin) => {
            const result = await returnFlow.cancel(rc.id, cancelNote, pin)
            if (result.ok) onChanged(result.value, 'Return cancelled.')
            return result
          }}
          onDone={() => setPinFor(null)}
          onCancel={() => setPinFor(null)}
        />
      )}
      {pinFor === 'complete' && (
        <PinDialog
          title="Complete return"
          message="Enter a PIN to complete this return."
          confirmLabel="Approve"
          onSubmit={async (pin) => {
            const result = await returnFlow.complete(rc.id, completeInput(), pin)
            if (result.ok) onChanged(result.value, 'Return completed — print the returns receipt below.')
            return result
          }}
          onDone={() => setPinFor(null)}
          onCancel={() => setPinFor(null)}
        />
      )}
    </section>
  )
}
