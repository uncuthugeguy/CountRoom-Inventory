import { paymentMethodLabel, paymentMethodOptions } from '../../domain/paymentMethods'
import { useId, useMemo, useState } from 'react'
import type { Role } from '../../data/repository'
import { searchProducts } from '../../domain/inventory'
import { returnsToCsv } from '../../domain/csv'
import { searchSales } from '../../domain/sales'
import {
  addReplacementLine,
  addReturnLine,
  breakdownByAction,
  buildEditReplacementCart,
  buildEditReturnCart,
  buildReturnCaseInput,
  canEditReturn,
  caseItems,
  caseStatus,
  deriveReturnActions,
  editReplacementCartHasIssues,
  editReplacementLineIssue,
  emptyReplacementCart,
  emptyReturnCart,
  expectedItemsFrom,
  isOpenReturn,
  openReturns,
  pendingInspections,
  removeReplacementLine,
  removeReturnLine,
  replacementCartHasIssues,
  replacementLineIssue,
  returnImpact,
  returnsSince,
  searchReturns,
  setReplacementLineQuantity,
  setReturnLineDisposition,
  setReturnLineQuantity,
  summariseReturns,
  validateReturnCaseInput,
  wasEdited,
  type PendingInspection,
  type ReplacementCart,
  type ReturnCart,
  type ReturnCaseDraft,
} from '../../domain/returns'
import {
  GOODWILL_TYPES,
  GOODWILL_TYPE_LABELS,
  RETURN_ACTIONS,
  RETURN_ACTION_LABELS,
  RETURN_STATUS_LABELS,
  STOCK_DISPOSITIONS,
  STOCK_DISPOSITION_CHOICE_LABELS,
  STOCK_DISPOSITION_LABELS,
  goodwillTypeLabel,
  type PaymentMethod,
  type Product,
  type Result,
  type ReturnCase,
  type ReturnCaseInput,
  type Sale,
  type StockDisposition,
} from '../../domain/types'
import { Dialog } from '../components/Dialog'
import { PinDialog } from '../components/PinDialog'
import { PrintPortal } from '../components/PrintPortal'
import { ReturnReceipt } from '../components/ReturnReceipt'
import { downloadCsv, timestampedFilename } from '../csvDownload'
import { formatCurrency, formatDateTime, formatNumber } from '../format'
import type { ReturnFlow } from '../useInventory'
import { StagedReturnPanel } from './StagedReturnPanel'

export interface ReturnsScreenProps {
  products: Product[]
  role: Role
  /** Past till sales, so a case can be linked back to the original transaction. */
  sales: Sale[]
  returns: ReturnCase[]
  /** The same PIN-checked, three-stage return flow CountRoom Register uses. */
  returnFlow: ReturnFlow
  /** Manager-only rebuild of a finished case (no PIN — manager sign-in). */
  onUpdateReturn: (id: string, input: ReturnCaseInput) => Promise<Result<ReturnCase>>
}

/** Read-only drill-down for one past case, opened from a row in the list
 * below. A manager can jump straight from here into editing a finished
 * case; a return still in progress opens its next stage instead. */
function ReturnDetailDialog({
  rc,
  sale,
  isManager,
  onClose,
  onEdit,
  onContinue,
}: {
  rc: ReturnCase
  /** The original sale, when the case is linked to one — for its order number. */
  sale?: Sale
  isManager: boolean
  onClose: () => void
  onEdit: () => void
  onContinue: () => void
}) {
  const impact = returnImpact(rc)
  const status = caseStatus(rc)
  return (
    <Dialog title="Return case" onClose={onClose}>
      <p className="muted">{formatDateTime(rc.createdAt)}</p>
      {rc.receiptRef && <p className="mono">Return no. {rc.receiptRef}</p>}
      <p>
        <span className="badge" data-testid="return-status">
          {RETURN_STATUS_LABELS[status]}
        </span>
      </p>
      {rc.labelSentAt && <p className="muted">Label sent {formatDateTime(rc.labelSentAt)}</p>}
      {rc.itemReceivedAt && <p className="muted">Item arrived {formatDateTime(rc.itemReceivedAt)}</p>}
      {rc.completedAt && status !== 'awaiting_refund' && (
        <p className="muted">
          {status === 'cancelled' ? 'Cancelled' : 'Completed'} {formatDateTime(rc.completedAt)}
        </p>
      )}
      {wasEdited(rc) && <p className="muted">Last edited {formatDateTime(rc.updatedAt!)}</p>}
      <p className="muted">{rc.customerRef || rc.channel || 'Unspecified'}</p>
      {sale?.orderNumber && <p className="muted">Original order: {sale.orderNumber}</p>}
      <div className="channel-picker">
        {rc.actions.map((action) => (
          <span key={action} className="badge">
            {RETURN_ACTION_LABELS[action]}
          </span>
        ))}
      </div>
      {rc.reason && <p>Reason: {rc.reason}</p>}
      {rc.notes && <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{rc.notes}</p>}

      {rc.returnLines.length === 0 && (rc.expectedItems?.length ?? 0) > 0 && (
        <>
          <p className="muted">Expected back</p>
          <table className="receipt-lines">
            <tbody>
              {rc.expectedItems!.map((item) => (
                <tr key={item.productId}>
                  <td>
                    {item.quantity} × {item.name} ({item.sku})
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

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
                    <td className="receipt-amount">{formatCurrency(line.unitCost * line.quantity)}</td>
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
                    <td className="receipt-amount">{formatCurrency(line.unitCost * line.quantity)}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {rc.refundAmount > 0 && (
        <p>
          Refund: {formatCurrency(rc.refundAmount)} ({rc.refundMethod ? paymentMethodLabel(rc.refundMethod) : 'Unspecified'})
        </p>
      )}
      {rc.goodwillValue > 0 && (
        <p>
          Goodwill: {formatCurrency(rc.goodwillValue)} ({rc.goodwillType ? goodwillTypeLabel(rc.goodwillType) : 'unspecified'})
        </p>
      )}
      {(rc.returnPostageCost ?? 0) > 0 && (
        <p data-testid="return-postage">Return postage label: {formatCurrency(rc.returnPostageCost ?? 0)}</p>
      )}
      {isManager && <p className="muted">Net cost to profit (after restocked stock): {formatCurrency(impact.totalCost)}</p>}

      <div className="dialog-actions">
        <button type="button" className="button" onClick={() => window.print()}>
          Print returns receipt
        </button>
        {isOpenReturn(rc) && (
          <button type="button" className="button button-primary" onClick={onContinue}>
            Continue this return
          </button>
        )}
        {isManager && canEditReturn(rc) && (
          <button type="button" className="button" onClick={onEdit}>
            Edit case
          </button>
        )}
        <button type="button" className="button button-ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <PrintPortal>
        <ReturnReceipt rc={rc} sale={sale} />
      </PrintPortal>
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

interface FormDraft {
  saleId: string
  channel: string
  customerRef: string
  reason: string
  notes: string
  refundAmount: string
  refundMethod: PaymentMethod
  goodwillType: string
  goodwillValue: string
  returnPostageCost: string
}

const emptyDraft = (): FormDraft => ({
  saleId: '',
  channel: '',
  customerRef: '',
  reason: '',
  notes: '',
  refundAmount: '',
  refundMethod: 'cash',
  goodwillType: '',
  goodwillValue: '',
  returnPostageCost: '',
})

type PinAction =
  | { kind: 'process' }
  | { kind: 'label' }
  | { kind: 'inspect'; line: PendingInspection; disposition: 'restock' | 'writeoff' }

export function ReturnsScreen({ products, role, sales, returns, returnFlow, onUpdateReturn }: ReturnsScreenProps) {
  const isManager = role === 'manager'
  const findReturnId = useId()
  const saleSearchId = useId()
  const channelId = useId()
  const customerId = useId()
  const reasonId = useId()
  const notesId = useId()
  const refundAmountId = useId()
  const goodwillTypeId = useId()
  const goodwillValueId = useId()
  const returnPostageId = useId()
  const returnSearchId = useId()
  const replacementSearchId = useId()
  const inspectionNoteId = useId()

  const [returnCart, setReturnCart] = useState<ReturnCart>(emptyReturnCart())
  const [replacementCart, setReplacementCart] = useState<ReplacementCart>(emptyReplacementCart())
  const [returnQuery, setReturnQuery] = useState('')
  const [replacementQuery, setReplacementQuery] = useState('')
  const [saleQuery, setSaleQuery] = useState('')
  const [findQuery, setFindQuery] = useState('')
  const [draft, setDraft] = useState<FormDraft>(emptyDraft())
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [lastCaseId, setLastCaseId] = useState<string | null>(null)
  const [range, setRange] = useState<Range>('7d')
  const [viewingCaseId, setViewingCaseId] = useState<string | null>(null)
  const [activeStagedId, setActiveStagedId] = useState<string | null>(null)
  const [editingCaseId, setEditingCaseId] = useState<string | null>(null)
  const [pinAction, setPinAction] = useState<PinAction | null>(null)
  const [inspectionNote, setInspectionNote] = useState('')

  // Cases are looked up by id from the live list so they stay current as
  // stages are saved (the list reloads after every step).
  const byId = useMemo(() => new Map(returns.map((rc) => [rc.id, rc])), [returns])
  const lastCase = lastCaseId ? byId.get(lastCaseId) ?? null : null
  const viewingCase = viewingCaseId ? byId.get(viewingCaseId) ?? null : null
  const activeStaged = activeStagedId ? byId.get(activeStagedId) ?? null : null
  const editingCase = editingCaseId ? byId.get(editingCaseId) : undefined
  const linkedSale = draft.saleId ? sales.find((s) => s.id === draft.saleId) : undefined

  const returnMatches = useMemo(() => {
    if (!returnQuery.trim()) return []
    return searchProducts(products, returnQuery).slice(0, 6)
  }, [products, returnQuery])

  const replacementMatches = useMemo(() => {
    if (!replacementQuery.trim()) return []
    return searchProducts(products, replacementQuery).slice(0, 6)
  }, [products, replacementQuery])

  const saleMatches = useMemo(
    () => (saleQuery.trim() ? searchSales(sales, saleQuery, products).slice(0, 8) : []),
    [sales, saleQuery, products],
  )

  const foundReturns = useMemo(
    () => (findQuery.trim() ? searchReturns(returns, findQuery, products, sales).slice(0, 20) : []),
    [returns, findQuery, products, sales],
  )

  const inProgress = useMemo(() => openReturns(returns), [returns])
  const awaitingInspection = useMemo(() => pendingInspections(returns), [returns])

  const inRange = useMemo(() => returnsSince(returns, rangeStart(range)), [returns, range])
  const summary = useMemo(() => summariseReturns(inRange), [inRange])
  const byAction = useMemo(() => breakdownByAction(inRange), [inRange])

  /** Exact barcode/SKU match first (a scan), else the only search hit. */
  const scanPick = (query: string, matches: Product[]): Product | undefined => {
    const code = query.trim().toLowerCase()
    if (!code) return undefined
    return (
      products.find((p) => (p.barcode && p.barcode.toLowerCase() === code) || p.sku.toLowerCase() === code) ??
      (matches.length === 1 ? matches[0] : undefined)
    )
  }

  const linkSale = (sale: Sale) => {
    setDraft((current) => ({ ...current, saleId: sale.id, channel: current.channel || sale.channel || '' }))
    setSaleQuery('')
  }

  const unlinkSale = () => setDraft((current) => ({ ...current, saleId: '' }))

  const resetForm = () => {
    setReturnCart(emptyReturnCart())
    setReplacementCart(emptyReplacementCart())
    setDraft(emptyDraft())
    setReturnQuery('')
    setReplacementQuery('')
    setSaleQuery('')
  }

  /** Seeds the case-builder above from a previously saved case, switching
   * the screen into edit mode. */
  const startEdit = (rc: ReturnCase) => {
    setReturnCart(buildEditReturnCart(rc, products))
    setReplacementCart(buildEditReplacementCart(rc, products))
    setDraft({
      saleId: rc.saleId,
      channel: rc.channel,
      customerRef: rc.customerRef,
      reason: rc.reason,
      notes: rc.notes,
      refundAmount: rc.refundAmount ? String(rc.refundAmount) : '',
      refundMethod: rc.refundMethod ?? 'cash',
      goodwillType: rc.goodwillType,
      goodwillValue: rc.goodwillValue ? String(rc.goodwillValue) : '',
      returnPostageCost: rc.returnPostageCost ? String(rc.returnPostageCost) : '',
    })
    setReturnQuery('')
    setReplacementQuery('')
    setError(null)
    setEditingCaseId(rc.id)
    setViewingCaseId(null)
  }

  const cancelEdit = () => {
    setEditingCaseId(null)
    resetForm()
  }

  /** The form as a validated case, or an error shown to the user. */
  const buildInput = (): ReturnCaseInput | null => {
    setError(null)
    const refundAmount = draft.refundAmount.trim() === '' ? null : Number(draft.refundAmount)
    const goodwillValue =
      draft.goodwillType && draft.goodwillValue.trim() !== '' ? Number(draft.goodwillValue) : null
    const parsedDraft: ReturnCaseDraft = {
      saleId: draft.saleId,
      channel: draft.channel,
      customerRef: draft.customerRef,
      reason: draft.reason,
      notes: draft.notes,
      // Worked out from what's filled in, the way Register does it.
      actions: deriveReturnActions({
        returnLines: returnCart,
        replacementLines: replacementCart,
        refundAmount: refundAmount ?? 0,
        goodwillValue: goodwillValue ?? 0,
      }),
      refundAmount,
      refundMethod: draft.refundMethod,
      goodwillType: draft.goodwillType,
      goodwillValue,
      returnPostageCost: draft.returnPostageCost.trim() === '' ? null : Number(draft.returnPostageCost),
    }
    const input = buildReturnCaseInput(returnCart, replacementCart, parsedDraft)
    const validation = validateReturnCaseInput(input)
    if (!validation.ok) {
      setError(validation.error)
      return null
    }
    const cartIssues = editingCase
      ? editReplacementCartHasIssues(replacementCart, editingCase)
      : replacementCartHasIssues(replacementCart)
    if (cartIssues) {
      setError('Fix the stock issues below before saving.')
      return null
    }
    return input
  }

  const processNow = () => {
    if (buildInput()) setPinAction({ kind: 'process' })
  }

  const logLabel = () => {
    setError(null)
    if (returnCart.length === 0) {
      setError('Add the items the customer is sending back first.')
      return
    }
    const postage = draft.returnPostageCost.trim() === '' ? 0 : Number(draft.returnPostageCost)
    if (!Number.isFinite(postage) || postage < 0) {
      setError('Return postage cost must be zero or greater.')
      return
    }
    setPinAction({ kind: 'label' })
  }

  const saveEdit = async () => {
    const input = buildInput()
    if (!input || !editingCaseId) return
    setSaving(true)
    const result = await onUpdateReturn(editingCaseId, input)
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setLastCaseId(result.value.id)
    setNotice('Return case updated.')
    setEditingCaseId(null)
    resetForm()
  }

  const afterSaved = (rc: ReturnCase, message: string) => {
    setLastCaseId(rc.id)
    setNotice(message)
    resetForm()
  }

  const runPinAction = async (pin: string): Promise<Result<unknown>> => {
    if (!pinAction) return { ok: false, error: 'Nothing to approve.' }
    if (pinAction.kind === 'process') {
      const input = buildInput()
      if (!input) return { ok: false, error: error ?? 'Check the return details.' }
      const result = await returnFlow.recordWithPin(input, pin)
      if (result.ok) afterSaved(result.value, 'Return processed — print the returns receipt below.')
      return result
    }
    if (pinAction.kind === 'label') {
      const postage = draft.returnPostageCost.trim() === '' ? undefined : Number(draft.returnPostageCost)
      const result = await returnFlow.start(
        {
          saleId: draft.saleId || undefined,
          channel: draft.channel.trim() || undefined,
          customerRef: draft.customerRef.trim() || undefined,
          reason: draft.reason.trim() || undefined,
          notes: draft.notes.trim() || undefined,
          returnPostageCost: postage,
          expectedItems: expectedItemsFrom(returnCart),
        },
        pin,
      )
      if (result.ok) {
        afterSaved(result.value, 'Label logged — this return is now waiting for the item. Find it under Returns in progress.')
      }
      return result
    }
    const { line, disposition } = pinAction
    const result = await returnFlow.resolveInspection(line.lineId, disposition, pin, inspectionNote)
    if (result.ok) setNotice(disposition === 'restock' ? 'Item restocked.' : 'Item written off.')
    return result
  }

  const statusBadge = (rc: ReturnCase) => {
    const status = caseStatus(rc)
    if (status === 'completed') return null
    return <span className="badge">{RETURN_STATUS_LABELS[status]}</span>
  }

  const dispositionChoices: StockDisposition[] = editingCaseId
    ? // The edit rebuild only restocks or writes off (see canEditReturn).
      STOCK_DISPOSITIONS.filter((d) => d !== 'inspect')
    : STOCK_DISPOSITIONS

  if (activeStaged) {
    return (
      <div className="screen">
        <StagedReturnPanel
          key={`${activeStaged.id}-${caseStatus(activeStaged)}`}
          rc={activeStaged}
          products={products}
          returnFlow={returnFlow}
          onBack={() => setActiveStagedId(null)}
          onChanged={(updated, message) => {
            setNotice(message)
            if (updated) setLastCaseId(updated.id)
            setActiveStagedId(null)
          }}
        />
      </div>
    )
  }

  return (
    <div className="screen">
      <p className="muted">
        Same process as CountRoom Register: every return needs a PIN, and returned items default to "Inspect
        first" — they stay out of stock until someone inspects them under Awaiting inspection.
      </p>

      {notice && (
        <p className="notice" role="status" data-testid="returns-notice">
          {notice}
        </p>
      )}

      <section className="panel">
        <h2>Find a return</h2>
        <div className="field">
          <label htmlFor={findReturnId}>Search returns</label>
          <input
            id={findReturnId}
            type="search"
            autoComplete="off"
            placeholder="Scan a returns receipt, or type an order number, barcode, SKU or customer…"
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && foundReturns.length === 1) {
                e.preventDefault()
                setViewingCaseId(foundReturns[0].id)
              }
            }}
          />
        </div>
        {findQuery.trim() !== '' &&
          (foundReturns.length === 0 ? (
            <p className="empty">No returns match “{findQuery.trim()}”.</p>
          ) : (
            <ul className="plain-list history-list" data-testid="return-search-results">
              {foundReturns.map((rc) => (
                <li key={rc.id} className="history-row">
                  <div className="history-main">
                    <span className="history-product">{rc.customerRef || rc.channel || 'Unspecified'}</span>
                    {statusBadge(rc)}
                  </div>
                  <div className="history-meta">
                    {rc.receiptRef && <span className="mono muted">#{rc.receiptRef}</span>}
                    <span className="muted">{formatDateTime(rc.createdAt)}</span>
                    <span className="muted">
                      {caseItems(rc)
                        .map((i) => `${i.quantity}x ${i.sku}`)
                        .join(', ')}
                    </span>
                  </div>
                  <div className="dialog-actions">
                    <button type="button" className="button button-ghost" onClick={() => setViewingCaseId(rc.id)}>
                      View / print receipt
                    </button>
                    {isOpenReturn(rc) && (
                      <button type="button" className="button" onClick={() => setActiveStagedId(rc.id)}>
                        Continue
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ))}
      </section>

      {awaitingInspection.length > 0 && (
        <section className="panel" data-testid="awaiting-inspection">
          <h2>Awaiting inspection</h2>
          <p className="muted">
            Returned items that haven't gone back into stock yet. Check each one, then restock it or write it off.
          </p>
          <ul className="plain-list history-list">
            {awaitingInspection.map((line) => (
              <li key={line.lineId} className="history-row" data-testid="inspection-row">
                <div className="history-main">
                  <span className="history-product">
                    {line.quantity} × {line.name}
                  </span>
                  <span className="mono muted">{line.sku}</span>
                </div>
                <div className="history-meta">
                  <span className="muted">returned {formatDateTime(line.returnedAt)}</span>
                </div>
                <div className="dialog-actions">
                  <button
                    type="button"
                    className="button"
                    onClick={() => {
                      setInspectionNote('')
                      setPinAction({ kind: 'inspect', line, disposition: 'restock' })
                    }}
                  >
                    Restock
                  </button>
                  <button
                    type="button"
                    className="button button-ghost"
                    onClick={() => {
                      setInspectionNote('')
                      setPinAction({ kind: 'inspect', line, disposition: 'writeoff' })
                    }}
                  >
                    Write off
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {inProgress.length > 0 && (
        <section className="panel" data-testid="returns-in-progress">
          <h2>Returns in progress</h2>
          <ul className="plain-list history-list">
            {inProgress.map((rc) => (
              <li key={rc.id} className="history-row" data-testid="open-return-row">
                <div className="history-main">
                  <span className="history-product">
                    {(rc.expectedItems ?? []).map((i) => `${i.quantity} × ${i.name}`).join(', ') || 'Return'}
                    {rc.customerRef ? ` · ${rc.customerRef}` : ''}
                  </span>
                  {statusBadge(rc)}
                </div>
                <div className="history-meta">
                  <span className="muted">Label sent {formatDateTime(rc.labelSentAt ?? rc.createdAt)}</span>
                  {rc.receiptRef && <span className="mono muted">#{rc.receiptRef}</span>}
                </div>
                <div className="dialog-actions">
                  <button
                    type="button"
                    className="button"
                    onClick={() => {
                      setNotice(null)
                      setActiveStagedId(rc.id)
                    }}
                  >
                    Continue
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

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

      <h2>{editingCaseId ? 'Edit return' : 'New return'}</h2>

      <section className="panel">
        <h2>Original sale</h2>
        <p className="muted">
          Optional — scan the sale receipt, or search by order number, item barcode, SKU or name.
        </p>
        {linkedSale ? (
          <div data-testid="linked-sale">
            <p>
              {formatDateTime(linkedSale.createdAt)} — {linkedSale.channel || 'Unspecified'} —{' '}
              {formatCurrency(linkedSale.orderTotal ?? linkedSale.subtotal)}
              {linkedSale.orderNumber && ` · Order #${linkedSale.orderNumber}`}
            </p>
            <ul className="plain-list cart-list">
              {linkedSale.lines.map((line) => {
                const product = products.find((p) => p.id === line.productId)
                const already = returnCart.some((l) => l.product.id === line.productId)
                return (
                  <li key={line.id} className="cart-row">
                    <div className="cart-identity">
                      <span className="product-name">
                        {line.quantity} × {line.name}
                      </span>
                      <span className="mono muted">{line.sku}</span>
                    </div>
                    <div className="cart-fields">
                      {product ? (
                        <button
                          type="button"
                          className="button button-ghost"
                          disabled={already}
                          onClick={() =>
                            setReturnCart((current) =>
                              setReturnLineQuantity(addReturnLine(current, product), product.id, line.quantity),
                            )
                          }
                        >
                          {already ? 'Added' : 'Return this'}
                        </button>
                      ) : (
                        <span className="muted">No longer in catalogue</span>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
            <button type="button" className="button button-ghost" onClick={unlinkSale}>
              Unlink sale
            </button>
          </div>
        ) : (
          <>
            <div className="field">
              <label htmlFor={saleSearchId}>Find the original sale</label>
              <input
                id={saleSearchId}
                type="search"
                autoComplete="off"
                placeholder="Scan the receipt, or order number, barcode, SKU…"
                value={saleQuery}
                onChange={(e) => setSaleQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && saleMatches.length === 1) {
                    e.preventDefault()
                    linkSale(saleMatches[0])
                  }
                }}
              />
            </div>
            {saleQuery.trim() !== '' &&
              (saleMatches.length === 0 ? (
                <p className="empty">No sales match — you can still record the return without one.</p>
              ) : (
                <ul className="plain-list checkout-search-results" data-testid="sale-search-results">
                  {saleMatches.map((sale) => (
                    <li key={sale.id} className="checkout-search-row">
                      <span className="checkout-search-name">
                        {formatDateTime(sale.createdAt)} — {sale.channel || 'Unspecified'} —{' '}
                        {formatCurrency(sale.orderTotal ?? sale.subtotal)}
                      </span>
                      <span className="mono muted">
                        {sale.orderNumber ? `#${sale.orderNumber}` : sale.lines.map((l) => l.sku).join(', ')}
                      </span>
                      <button type="button" className="button button-ghost" onClick={() => linkSale(sale)}>
                        Link
                      </button>
                    </li>
                  ))}
                </ul>
              ))}
          </>
        )}
      </section>

      <section className="panel">
        <h2>Items returned</h2>
        <p className="muted">Search by name, SKU or scan a barcode to add an item the customer is sending back.</p>
        <div className="field">
          <label htmlFor={returnSearchId}>Search products to return</label>
          <input
            id={returnSearchId}
            type="search"
            value={returnQuery}
            autoComplete="off"
            placeholder="Product name, SKU, barcode…"
            onChange={(event) => setReturnQuery(event.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              const pick = scanPick(returnQuery, returnMatches)
              if (pick) {
                e.preventDefault()
                setReturnCart((current) => addReturnLine(current, pick))
                setReturnQuery('')
              }
            }}
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
                  <div className="channel-picker" role="group" aria-label={`What happens to ${line.product.name}`}>
                    {dispositionChoices.map((disposition) => (
                      <button
                        key={disposition}
                        type="button"
                        className={`button chip-button ${line.disposition === disposition ? 'chip-button-active' : ''}`}
                        aria-pressed={line.disposition === disposition}
                        onClick={() =>
                          setReturnCart((current) => setReturnLineDisposition(current, line.product.id, disposition))
                        }
                      >
                        {STOCK_DISPOSITION_CHOICE_LABELS[disposition]}
                      </button>
                    ))}
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
            placeholder="Product name, SKU, barcode…"
            onChange={(event) => setReplacementQuery(event.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              const pick = scanPick(replacementQuery, replacementMatches)
              if (pick) {
                e.preventDefault()
                setReplacementCart((current) => addReplacementLine(current, pick))
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
        <h2>Refund or goodwill</h2>
        <div className="field-row">
          <div className="field">
            <label htmlFor={refundAmountId}>Refund amount</label>
            <input
              id={refundAmountId}
              type="number"
              min={0}
              step={0.01}
              inputMode="decimal"
              placeholder="0.00"
              value={draft.refundAmount}
              onChange={(e) => setDraft((current) => ({ ...current, refundAmount: e.target.value }))}
            />
          </div>
          <div className="field">
            <span>Refund method</span>
            <div className="channel-picker">
              {paymentMethodOptions(draft.refundMethod).map((method) => (
                <button
                  key={method}
                  type="button"
                  className={`button chip-button ${draft.refundMethod === method ? 'chip-button-active' : ''}`}
                  aria-pressed={draft.refundMethod === method}
                  onClick={() => setDraft((current) => ({ ...current, refundMethod: method }))}
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
            <select
              id={goodwillTypeId}
              value={draft.goodwillType}
              onChange={(e) => setDraft((current) => ({ ...current, goodwillType: e.target.value }))}
            >
              <option value="">None</option>
              {GOODWILL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {GOODWILL_TYPE_LABELS[t]}
                </option>
              ))}
              {draft.goodwillType && !(GOODWILL_TYPES as readonly string[]).includes(draft.goodwillType) && (
                <option value={draft.goodwillType}>{draft.goodwillType}</option>
              )}
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
              disabled={draft.goodwillType === ''}
              value={draft.goodwillValue}
              onChange={(e) => setDraft((current) => ({ ...current, goodwillValue: e.target.value }))}
            />
          </div>
        </div>
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
          <label htmlFor={returnPostageId}>Return postage label cost (optional)</label>
          <input
            id={returnPostageId}
            type="number"
            min={0}
            step={0.01}
            inputMode="decimal"
            value={draft.returnPostageCost}
            placeholder="What you paid for the buyer's return label"
            onChange={(e) => setDraft((current) => ({ ...current, returnPostageCost: e.target.value }))}
          />
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

      {editingCaseId ? (
        <button
          type="button"
          className="button button-primary checkout-submit"
          disabled={saving}
          onClick={saveEdit}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      ) : (
        <>
          <section className="panel">
            <h2>Doing this in stages?</h2>
            <p className="muted">
              Log the label now and pause the return until the item arrives — then mark it arrived, then issue
              the refund. Stock and refunds wait until their stage; the refund section above is ignored here.
            </p>
            <button type="button" className="button" disabled={returnCart.length === 0} onClick={logLabel}>
              Stage 1: label sent — wait for the item (PIN)
            </button>
          </section>
          <button type="button" className="button button-primary checkout-submit" onClick={processNow}>
            Process whole return now (PIN)
          </button>
        </>
      )}

      {lastCase && (
        <section className="panel" data-testid="last-return">
          <header className="panel-header">
            <h2>Last return saved</h2>
            <span className="mono">{lastCase.receiptRef ? `#${lastCase.receiptRef}` : lastCase.channel || 'Unspecified'}</span>
          </header>
          <div className="channel-picker">
            {statusBadge(lastCase)}
            {lastCase.actions.map((action) => (
              <span key={action} className="badge">
                {RETURN_ACTION_LABELS[action]}
              </span>
            ))}
          </div>
          {lastCase.refundAmount > 0 && <p className="muted">Refund: {formatCurrency(lastCase.refundAmount)}</p>}
          {lastCase.goodwillValue > 0 && (
            <p className="muted">
              Goodwill: {formatCurrency(lastCase.goodwillValue)} (
              {lastCase.goodwillType ? goodwillTypeLabel(lastCase.goodwillType) : 'unspecified'})
            </p>
          )}
          {(lastCase.returnPostageCost ?? 0) > 0 && (
            <p className="muted">Return postage: {formatCurrency(lastCase.returnPostageCost ?? 0)}</p>
          )}
          <div className="dialog-actions">
            <button type="button" className="button" onClick={() => setViewingCaseId(lastCase.id)}>
              View / print receipt
            </button>
          </div>
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
          <div className="stat" data-testid="returns-awaiting-inspection">
            <span className="stat-value">{formatNumber(summary.itemsAwaitingInspection)}</span>
            <span className="stat-label">Awaiting inspection</span>
          </div>
          {isManager && (
            <div className="stat" data-testid="returns-total-cost">
              <span className="stat-value">{formatCurrency(summary.totalCost)}</span>
              <span className="stat-label">Net cost to profit</span>
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
                const items = caseItems(rc)
                return (
                  <li key={rc.id} className="history-row" data-testid="return-case-row">
                    <div className="history-main">
                      <span className="history-product">{rc.customerRef || rc.channel || 'Unspecified'}</span>
                      {statusBadge(rc)}
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
                      {rc.receiptRef && <span className="mono muted">#{rc.receiptRef}</span>}
                      <span className="muted">{formatDateTime(rc.createdAt)}</span>
                      {wasEdited(rc) && <span className="badge">Edited</span>}
                      {rc.reason && <span className="reason">{rc.reason}</span>}
                      {items.length > 0 && (
                        <span className="muted">
                          {rc.returnLines.length > 0
                            ? rc.returnLines
                                .map((l) => `${l.quantity}x ${l.sku} (${STOCK_DISPOSITION_LABELS[l.disposition]})`)
                                .join(', ')
                            : items.map((l) => `${l.quantity}x ${l.sku} (expected)`).join(', ')}
                        </span>
                      )}
                    </div>
                    <div className="dialog-actions">
                      <button type="button" className="button button-ghost" onClick={() => setViewingCaseId(rc.id)}>
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
          sale={viewingCase.saleId ? sales.find((s) => s.id === viewingCase.saleId) : undefined}
          isManager={isManager}
          onClose={() => setViewingCaseId(null)}
          onEdit={() => startEdit(viewingCase)}
          onContinue={() => {
            setViewingCaseId(null)
            setActiveStagedId(viewingCase.id)
          }}
        />
      )}

      {pinAction && (
        <PinDialog
          title={
            pinAction.kind === 'process'
              ? 'Process return'
              : pinAction.kind === 'label'
                ? 'Label sent'
                : pinAction.disposition === 'restock'
                  ? 'Restock after inspection'
                  : 'Write off after inspection'
          }
          message={
            pinAction.kind === 'process'
              ? 'Enter a PIN to approve this return.'
              : pinAction.kind === 'label'
                ? 'Enter a PIN to log the return label and pause this return until the item arrives.'
                : `${pinAction.line.quantity} × ${pinAction.line.name} — ${
                    pinAction.disposition === 'restock' ? 'adds it back into stock' : 'keeps it out of stock for good'
                  }. Enter a PIN.`
          }
          confirmLabel={
            pinAction.kind === 'process'
              ? 'Approve'
              : pinAction.kind === 'label'
                ? 'Log label'
                : pinAction.disposition === 'restock'
                  ? 'Restock'
                  : 'Write off'
          }
          onSubmit={runPinAction}
          onDone={() => setPinAction(null)}
          onCancel={() => setPinAction(null)}
        >
          {pinAction.kind === 'inspect' && (
            <div className="field">
              <label htmlFor={inspectionNoteId}>Inspection note (optional)</label>
              <input
                id={inspectionNoteId}
                value={inspectionNote}
                onChange={(e) => setInspectionNote(e.target.value)}
              />
            </div>
          )}
        </PinDialog>
      )}
    </div>
  )
}
