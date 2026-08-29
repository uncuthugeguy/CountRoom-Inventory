import { useId, useMemo, useState } from 'react'
import type { Role } from '../../data/repository'
import { searchProducts } from '../../domain/inventory'
import { returnsToCsv } from '../../domain/csv'
import {
  addReplacementLine,
  addReturnLine,
  breakdownByAction,
  buildEditReplacementCart,
  buildEditReturnCart,
  buildReturnCaseInput,
  editReplacementCartHasIssues,
  editReplacementLineIssue,
  emptyReplacementCart,
  emptyReturnCart,
  removeReplacementLine,
  removeReturnLine,
  replacementCartHasIssues,
  replacementLineIssue,
  returnImpact,
  returnsSince,
  setReplacementLineQuantity,
  setReturnLineDisposition,
  setReturnLineQuantity,
  summariseReturns,
  validateReturnCaseInput,
  type ReplacementCart,
  type ReturnCart,
  type ReturnCaseDraft,
} from '../../domain/returns'
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  RETURN_ACTIONS,
  RETURN_ACTION_LABELS,
  STOCK_DISPOSITIONS,
  STOCK_DISPOSITION_LABELS,
  type PaymentMethod,
  type Product,
  type Result,
  type ReturnAction,
  type ReturnCase,
  type ReturnCaseInput,
  type Sale,
  type StockDisposition,
} from '../../domain/types'
import { Dialog } from '../components/Dialog'
import { downloadCsv, timestampedFilename } from '../csvDownload'
import { formatCurrency, formatDateTime, formatNumber } from '../format'

export interface ReturnsScreenProps {
  products: Product[]
  role: Role
  /** Past till sales, so a case can be linked back to the original transaction. */
  sales: Sale[]
  returns: ReturnCase[]
  onRecordReturn: (input: ReturnCaseInput) => Promise<Result<ReturnCase>>
  onUpdateReturn: (id: string, input: ReturnCaseInput) => Promise<Result<ReturnCase>>
}

/** Read-only drill-down for one past case, opened from a row in the list
 * below. A manager can jump straight from here into editing it, reusing the
 * same builder at the top of this screen. */
function ReturnDetailDialog({
  rc,
  isManager,
  onClose,
  onEdit,
}: {
  rc: ReturnCase
  isManager: boolean
  onClose: () => void
  onEdit: () => void
}) {
  const impact = returnImpact(rc)
  return (
    <Dialog title="Return case" onClose={onClose}>
      <p className="muted">{formatDateTime(rc.createdAt)}</p>
      {rc.updatedAt && <p className="muted">Last edited {formatDateTime(rc.updatedAt)}</p>}
      <p className="muted">{rc.customerRef || rc.channel || 'Unspecified'}</p>
      <div className="channel-picker">
        {rc.actions.map((action) => (
          <span key={action} className="badge">
            {RETURN_ACTION_LABELS[action]}
          </span>
        ))}
      </div>
      {rc.reason && <p>Reason: {rc.reason}</p>}
      {rc.notes && <p className="muted">{rc.notes}</p>}

      {rc.returnLines.length > 0 && (
        <>
          <p className="muted">Items returned</p>
          <table className="receipt-lines">
            <tbody>
              {rc.returnLines.map((line) => (
                <tr key={line.id}>
                  <td>
                    {line.quantity} × {line.name} ({line.sku}) — {STOCK_DISPOSITION_LABELS[line.disposition]}
                  </td>
                  {isManager && (
                    <td className="receipt-amount">{formatCurrency((line.unitCost * line.quantity))}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {rc.replacementLines.length > 0 && (
        <>
          <p className="muted">Replacement sent</p>
          <table className="receipt-lines">
            <tbody>
              {rc.replacementLines.map((line) => (
                <tr key={line.id}>
                  <td>
                    {line.quantity} × {line.name} ({line.sku})
                  </td>
                  {isManager && (
                    <td className="receipt-amount">{formatCurrency((line.unitCost * line.quantity))}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {rc.refundAmount > 0 && (
        <p>
          Refund: {formatCurrency(rc.refundAmount)} ({rc.refundMethod ? PAYMENT_METHOD_LABELS[rc.refundMethod] : 'Unspecified'})
        </p>
      )}
      {rc.goodwillValue > 0 && (
        <p>
          Goodwill: {formatCurrency(rc.goodwillValue)} ({rc.goodwillType || 'unspecified'})
        </p>
      )}
      {isManager && <p className="muted">Total cost to business: {formatCurrency(impact.totalCost)}</p>}

      <div className="dialog-actions">
        {isManager && (
          <button type="button" className="button" onClick={onEdit}>
            Edit case
          </button>
        )}
        <button type="button" className="button button-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  )
}

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

const emptyDraft = (): {
  saleId: string
  channel: string
  customerRef: string
  reason: string
  notes: string
  actions: ReturnAction[]
  refundAmount: string
  refundMethod: PaymentMethod
  goodwillType: string
  goodwillValue: string
} => ({
  saleId: '',
  channel: '',
  customerRef: '',
  reason: '',
  notes: '',
  actions: [],
  refundAmount: '',
  refundMethod: 'cash',
  goodwillType: '',
  goodwillValue: '',
})

export function ReturnsScreen({
  products,
  role,
  sales,
  returns,
  onRecordReturn,
  onUpdateReturn,
}: ReturnsScreenProps) {
  const isManager = role === 'manager'
  const saleId = useId()
  const channelId = useId()
  const customerId = useId()
  const reasonId = useId()
  const notesId = useId()
  const refundAmountId = useId()
  const goodwillTypeId = useId()
  const goodwillValueId = useId()
  const returnSearchId = useId()
  const replacementSearchId = useId()

  const [returnCart, setReturnCart] = useState<ReturnCart>(emptyReturnCart())
  const [replacementCart, setReplacementCart] = useState<ReplacementCart>(emptyReplacementCart())
  const [returnQuery, setReturnQuery] = useState('')
  const [replacementQuery, setReplacementQuery] = useState('')
  const [draft, setDraft] = useState(emptyDraft())
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [lastCase, setLastCase] = useState<ReturnCase | null>(null)
  const [range, setRange] = useState<Range>('7d')
  const [viewingCase, setViewingCase] = useState<ReturnCase | null>(null)
  const [editingCaseId, setEditingCaseId] = useState<string | null>(null)

  const returnMatches = useMemo(() => {
    if (!returnQuery.trim()) return []
    return searchProducts(products, returnQuery).slice(0, 6)
  }, [products, returnQuery])

  const replacementMatches = useMemo(() => {
    if (!replacementQuery.trim()) return []
    return searchProducts(products, replacementQuery).slice(0, 6)
  }, [products, replacementQuery])

  const toggleAction = (action: ReturnAction) => {
    setDraft((current) => ({
      ...current,
      actions: current.actions.includes(action)
        ? current.actions.filter((a) => a !== action)
        : [...current.actions, action],
    }))
  }

  const pickSale = (id: string) => {
    const sale = sales.find((s) => s.id === id)
    setDraft((current) => ({
      ...current,
      saleId: id,
      channel: current.channel || sale?.channel || current.channel,
    }))
  }

  const editingCase = useMemo(
    () => (editingCaseId ? returns.find((rc) => rc.id === editingCaseId) : undefined),
    [editingCaseId, returns],
  )

  const inRange = useMemo(() => returnsSince(returns, rangeStart(range)), [returns, range])
  const summary = useMemo(() => summariseReturns(inRange), [inRange])
  const byAction = useMemo(() => breakdownByAction(inRange), [inRange])

  const resetForm = () => {
    setReturnCart(emptyReturnCart())
    setReplacementCart(emptyReplacementCart())
    setDraft(emptyDraft())
    setReturnQuery('')
    setReplacementQuery('')
  }

  /** Seeds the case-builder above from a previously saved case, switching
   * the screen into edit mode — rather than a separate dialog-based editor,
   * this reuses the same builder the case was originally created in. */
  const startEdit = (rc: ReturnCase) => {
    setReturnCart(buildEditReturnCart(rc, products))
    setReplacementCart(buildEditReplacementCart(rc, products))
    setDraft({
      saleId: rc.saleId,
      channel: rc.channel,
      customerRef: rc.customerRef,
      reason: rc.reason,
      notes: rc.notes,
      actions: rc.actions,
      refundAmount: rc.refundAmount ? String(rc.refundAmount) : '',
      refundMethod: rc.refundMethod ?? 'cash',
      goodwillType: rc.goodwillType,
      goodwillValue: rc.goodwillValue ? String(rc.goodwillValue) : '',
    })
    setReturnQuery('')
    setReplacementQuery('')
    setError(null)
    setEditingCaseId(rc.id)
    setViewingCase(null)
  }

  const cancelEdit = () => {
    setEditingCaseId(null)
    resetForm()
  }

  const submit = async () => {
    setError(null)

    const parsedDraft: ReturnCaseDraft = {
      saleId: draft.saleId,
      channel: draft.channel,
      customerRef: draft.customerRef,
      reason: draft.reason,
      notes: draft.notes,
      actions: draft.actions,
      refundAmount: draft.refundAmount.trim() === '' ? null : Number(draft.refundAmount),
      refundMethod: draft.refundMethod,
      goodwillType: draft.goodwillType,
      goodwillValue: draft.goodwillValue.trim() === '' ? null : Number(draft.goodwillValue),
    }

    const input = buildReturnCaseInput(returnCart, replacementCart, parsedDraft)
    const validation = validateReturnCaseInput(input)
    if (!validation.ok) {
      setError(validation.error)
      return
    }

    const cartIssues = editingCase
      ? editReplacementCartHasIssues(replacementCart, editingCase)
      : replacementCartHasIssues(replacementCart)
    if (cartIssues) {
      setError('Fix the stock issues below before saving.')
      return
    }

    setSaving(true)
    const result = editingCaseId
      ? await onUpdateReturn(editingCaseId, input)
      : await onRecordReturn(input)
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setLastCase(result.value)
    setEditingCaseId(null)
    resetForm()
  }

  return (
    <div className="screen">
      {editingCaseId && (
        <section className="panel" data-testid="return-edit-banner">
          <div className="toolbar">
            <p className="muted">Editing a past case — saving will replace it.</p>
            <button type="button" className="button button-ghost" onClick={cancelEdit}>
              Cancel edit
            </button>
          </div>
        </section>
      )}

      <section className="panel">
        <h2>Link to a sale</h2>
        <p className="muted">Optional — connects this case back to the original till transaction.</p>
        <div className="field">
          <label htmlFor={saleId}>Original sale</label>
          <select id={saleId} value={draft.saleId} onChange={(e) => pickSale(e.target.value)}>
            <option value="">No linked sale</option>
            {sales.slice(0, 100).map((sale) => (
              <option key={sale.id} value={sale.id}>
                {formatDateTime(sale.createdAt)} — {sale.channel || 'Unspecified'} — {formatCurrency(sale.subtotal)}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="panel">
        <h2>Items returned</h2>
        <p className="muted">Search by name, SKU or scan to add an item the customer sent back.</p>
        <div className="field">
          <label htmlFor={returnSearchId}>Search products to return</label>
          <input
            id={returnSearchId}
            type="search"
            value={returnQuery}
            autoComplete="off"
            placeholder="Product name, SKU, category…"
            onChange={(event) => setReturnQuery(event.target.value)}
          />
        </div>

        {returnMatches.length > 0 && (
          <ul className="plain-list checkout-search-results">
            {returnMatches.map((product) => (
              <li key={product.id} className="checkout-search-row">
                <span className="checkout-search-name">{product.name}</span>
                <span className="mono muted">{product.sku}</span>
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={() => {
                    setReturnCart((current) => addReturnLine(current, product))
                    setReturnQuery('')
                  }}
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        )}

        {returnCart.length === 0 ? (
          <p className="empty">No items added. A case doesn't need one — a refund or note-only record is fine.</p>
        ) : (
          <ul className="plain-list cart-list">
            {returnCart.map((line) => (
              <li key={line.product.id} className="cart-row" data-testid="return-cart-row">
                <div className="cart-identity">
                  <span className="product-name">{line.product.name}</span>
                  <span className="mono muted">{line.product.sku}</span>
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
                      aria-label={`Returned quantity for ${line.product.name}`}
                      onChange={(e) => {
                        const parsed = Number(e.target.value)
                        if (!Number.isFinite(parsed)) return
                        setReturnCart((current) =>
                          setReturnLineQuantity(current, line.product.id, Math.max(1, Math.trunc(parsed))),
                        )
                      }}
                    />
                  </label>
                  <div className="channel-picker" role="group" aria-label={`Disposition for ${line.product.name}`}>
                    {STOCK_DISPOSITIONS.map((disposition: StockDisposition) => {
                      const locked = disposition === 'writeoff' && !isManager
                      return (
                        <button
                          key={disposition}
                          type="button"
                          className={`button chip-button ${line.disposition === disposition ? 'chip-button-active' : ''}`}
                          aria-pressed={line.disposition === disposition}
                          disabled={locked}
                          title={locked ? 'Only a manager can write off returned stock' : undefined}
                          onClick={() =>
                            setReturnCart((current) => setReturnLineDisposition(current, line.product.id, disposition))
                          }
                        >
                          {STOCK_DISPOSITION_LABELS[disposition]}
                        </button>
                      )
                    })}
                  </div>
                  <button
                    type="button"
                    className="button button-ghost"
                    aria-label={`Remove ${line.product.name} from return`}
                    onClick={() => setReturnCart((current) => removeReturnLine(current, line.product.id))}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>Replacement sent out</h2>
        <p className="muted">Only for a swap — decrements stock like a sale, but at no charge.</p>
        <div className="field">
          <label htmlFor={replacementSearchId}>Search products to send out</label>
          <input
            id={replacementSearchId}
            type="search"
            value={replacementQuery}
            autoComplete="off"
            placeholder="Product name, SKU, category…"
            onChange={(event) => setReplacementQuery(event.target.value)}
          />
        </div>

        {replacementMatches.length > 0 && (
          <ul className="plain-list checkout-search-results">
            {replacementMatches.map((product) => (
              <li key={product.id} className="checkout-search-row">
                <span className="checkout-search-name">{product.name}</span>
                <span className="mono muted">{product.sku}</span>
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={() => {
                    setReplacementCart((current) => addReplacementLine(current, product))
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
              const issue = editingCase ? editReplacementLineIssue(line, editingCase) : replacementLineIssue(line)
              return (
                <li key={line.product.id} className="cart-row" data-testid="replacement-cart-row">
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
                        aria-label={`Replacement quantity for ${line.product.name}`}
                        onChange={(e) => {
                          const parsed = Number(e.target.value)
                          if (!Number.isFinite(parsed)) return
                          setReplacementCart((current) =>
                            setReplacementLineQuantity(current, line.product.id, Math.max(1, Math.trunc(parsed))),
                          )
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="button button-ghost"
                      aria-label={`Remove ${line.product.name} from replacement`}
                      onClick={() => setReplacementCart((current) => removeReplacementLine(current, line.product.id))}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>What happened</h2>
        <div className="channel-picker" role="group" aria-label="Actions">
          {RETURN_ACTIONS.map((action) => {
            const locked = (action === 'refund' || action === 'goodwill') && !isManager
            return (
              <button
                key={action}
                type="button"
                className={`button chip-button ${draft.actions.includes(action) ? 'chip-button-active' : ''}`}
                aria-pressed={draft.actions.includes(action)}
                disabled={locked}
                title={locked ? 'Only a manager can process this' : undefined}
                onClick={() => toggleAction(action)}
              >
                {RETURN_ACTION_LABELS[action]}
              </button>
            )
          })}
        </div>
        {!isManager && (
          <p className="hint">Refunds and goodwill gestures need a manager — ask them to save this case.</p>
        )}

        {draft.actions.includes('refund') && (
          <div className="field-row">
            <div className="field">
              <label htmlFor={refundAmountId}>Refund amount</label>
              <input
                id={refundAmountId}
                type="number"
                min={0}
                step={0.01}
                inputMode="decimal"
                value={draft.refundAmount}
                onChange={(e) => setDraft((current) => ({ ...current, refundAmount: e.target.value }))}
              />
            </div>
            <div className="field">
              <span>Refund method</span>
              <div className="channel-picker">
                {PAYMENT_METHODS.map((method) => (
                  <button
                    key={method}
                    type="button"
                    className={`button chip-button ${draft.refundMethod === method ? 'chip-button-active' : ''}`}
                    aria-pressed={draft.refundMethod === method}
                    onClick={() => setDraft((current) => ({ ...current, refundMethod: method }))}
                  >
                    {PAYMENT_METHOD_LABELS[method]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {draft.actions.includes('goodwill') && (
          <div className="field-row">
            <div className="field">
              <label htmlFor={goodwillTypeId}>Goodwill type</label>
              <input
                id={goodwillTypeId}
                value={draft.goodwillType}
                autoComplete="off"
                placeholder="Voucher, store credit, discount code…"
                onChange={(e) => setDraft((current) => ({ ...current, goodwillType: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor={goodwillValueId}>Goodwill value</label>
              <input
                id={goodwillValueId}
                type="number"
                min={0}
                step={0.01}
                inputMode="decimal"
                value={draft.goodwillValue}
                onChange={(e) => setDraft((current) => ({ ...current, goodwillValue: e.target.value }))}
              />
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Details</h2>
        <div className="field-row">
          <div className="field">
            <label htmlFor={channelId}>Channel</label>
            <input
              id={channelId}
              value={draft.channel}
              autoComplete="off"
              placeholder="Where the sale happened"
              onChange={(e) => setDraft((current) => ({ ...current, channel: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor={customerId}>Customer</label>
            <input
              id={customerId}
              value={draft.customerRef}
              autoComplete="off"
              placeholder="Name, email or order number"
              onChange={(e) => setDraft((current) => ({ ...current, customerRef: e.target.value }))}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor={reasonId}>Reason</label>
          <input
            id={reasonId}
            value={draft.reason}
            autoComplete="off"
            placeholder="Faulty, wrong size, changed mind…"
            onChange={(e) => setDraft((current) => ({ ...current, reason: e.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor={notesId}>Notes</label>
          <textarea
            id={notesId}
            rows={3}
            value={draft.notes}
            onChange={(e) => setDraft((current) => ({ ...current, notes: e.target.value }))}
          />
        </div>
      </section>

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        className="button button-primary checkout-submit"
        disabled={saving}
        onClick={submit}
      >
        {saving ? 'Saving…' : editingCaseId ? 'Save changes' : 'Save case'}
      </button>

      {lastCase && (
        <section className="panel" data-testid="last-return">
          <header className="panel-header">
            <h2>Last case saved</h2>
            <span className="mono">{lastCase.channel || 'Unspecified'}</span>
          </header>
          <div className="channel-picker">
            {lastCase.actions.map((action) => (
              <span key={action} className="badge">
                {RETURN_ACTION_LABELS[action]}
              </span>
            ))}
          </div>
          {lastCase.refundAmount > 0 && <p className="muted">Refund: {formatCurrency(lastCase.refundAmount)}</p>}
          {lastCase.goodwillValue > 0 && (
            <p className="muted">
              Goodwill: {formatCurrency(lastCase.goodwillValue)} ({lastCase.goodwillType || 'unspecified'})
            </p>
          )}
        </section>
      )}

      <section className="panel">
        <div className="toolbar">
          <h2>Cases</h2>
          {isManager && (
            <div className="toolbar-actions">
              <button
                type="button"
                className="button"
                onClick={() => downloadCsv(timestampedFilename('returns'), returnsToCsv(inRange))}
              >
                Export returns CSV
              </button>
            </div>
          )}
        </div>

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

        <section className="stats" aria-label="Returns summary">
          <div className="stat" data-testid="returns-case-count">
            <span className="stat-value">{formatNumber(summary.caseCount)}</span>
            <span className="stat-label">Cases</span>
          </div>
          <div className="stat" data-testid="returns-refund-total">
            <span className="stat-value">{formatCurrency(summary.refundTotal)}</span>
            <span className="stat-label">Refunded</span>
          </div>
          <div className="stat" data-testid="returns-goodwill-total">
            <span className="stat-value">{formatCurrency(summary.goodwillTotal)}</span>
            <span className="stat-label">Goodwill given</span>
          </div>
          {isManager && (
            <div className="stat stat-danger" data-testid="returns-writeoff-loss">
              <span className="stat-value">{formatCurrency(summary.writeOffLoss)}</span>
              <span className="stat-label">Written-off loss</span>
            </div>
          )}
          <div className="stat" data-testid="returns-restocked">
            <span className="stat-value">{formatNumber(summary.itemsRestocked)}</span>
            <span className="stat-label">Items restocked</span>
          </div>
          {isManager && (
            <div className="stat" data-testid="returns-total-cost">
              <span className="stat-value">{formatCurrency(summary.totalCost)}</span>
              <span className="stat-label">Total cost</span>
            </div>
          )}
        </section>

        {inRange.length === 0 ? (
          <p className="empty">No return cases in this range yet.</p>
        ) : (
          <>
            <div className="field-row">
              <section className="panel">
                <h3>By action</h3>
                <ul className="plain-list">
                  {RETURN_ACTIONS.map((action) => (
                    <li key={action} className="breakdown-row">
                      <span>{RETURN_ACTION_LABELS[action]}</span>
                      <span className="mono">{byAction[action]}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            <ul className="plain-list history-list">
              {inRange.map((rc) => {
                const impact = returnImpact(rc)
                return (
                  <li key={rc.id} className="history-row" data-testid="return-case-row">
                    <div className="history-main">
                      <span className="history-product">{rc.customerRef || rc.channel || 'Unspecified'}</span>
                      {rc.actions.map((action) => (
                        <span key={action} className="badge">
                          {RETURN_ACTION_LABELS[action]}
                        </span>
                      ))}
                    </div>
                    <div className="history-numbers">
                      {isManager && <span className="mono">{formatCurrency(impact.totalCost)}</span>}
                      <span className="muted">refund {formatCurrency(impact.refundTotal)}</span>
                    </div>
                    <div className="history-meta">
                      <span className="muted">{formatDateTime(rc.createdAt)}</span>
                      {rc.updatedAt && <span className="badge">Edited</span>}
                      {rc.reason && <span className="reason">{rc.reason}</span>}
                      {rc.returnLines.length > 0 && (
                        <span className="muted">
                          {rc.returnLines
                            .map((l) => `${l.quantity}x ${l.sku} (${STOCK_DISPOSITION_LABELS[l.disposition]})`)
                            .join(', ')}
                        </span>
                      )}
                    </div>
                    <div className="dialog-actions">
                      <button
                        type="button"
                        className="button button-ghost"
                        onClick={() => setViewingCase(rc)}
                      >
                        View details
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </section>

      {viewingCase && (
        <ReturnDetailDialog
          rc={viewingCase}
          isManager={isManager}
          onClose={() => setViewingCase(null)}
          onEdit={() => startEdit(viewingCase)}
        />
      )}
    </div>
  )
}
