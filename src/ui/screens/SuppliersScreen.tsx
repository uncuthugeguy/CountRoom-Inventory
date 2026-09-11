import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { Inventory } from '../useInventory'
import type { Product, Result } from '../../domain/types'
import type {
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderStatus,
  Supplier,
  SupplierDraft,
  UnboxedLineItemInput,
} from '../../domain/suppliers'
import { calculatePOGrandTotal, nextPoNumber } from '../../domain/suppliers'
import { nextSku } from '../../domain/products'
import {
  clearSupplierDraft,
  loadSupplierDraftFor,
  saveSupplierDraft,
  type SupplierDraftContext,
} from '../../data/supplierDraftStorage'
import {
  clearPurchaseOrderDraft,
  loadPurchaseOrderDraft,
  savePurchaseOrderDraft,
  type PurchaseOrderDraft,
  type PurchaseOrderDraftLine,
  type PurchaseOrderDraftLineKind,
} from '../../data/purchaseOrderDraftStorage'
import { Dialog } from '../components/Dialog'
import { CloseIcon } from '../components/Icons'
import { formatCurrency } from '../format'

export interface SuppliersScreenProps {
  inventory: Inventory
  products: Product[]
  /** Overridden in tests; backs the supplier-form autosave (see supplierDraftStorage.ts). */
  supplierDraftStorage?: Storage
  /** Overridden in tests; backs the new-PO-form autosave (see purchaseOrderDraftStorage.ts). */
  purchaseOrderDraftStorage?: Storage
}

const EMPTY_SUPPLIER_DRAFT: SupplierDraft = {
  name: '',
  email: '',
  phone: '',
  address: '',
  leadTimeDays: 0,
  contactName: '',
  notes: '',
}

const EMPTY_PO_LINE: PurchaseOrderDraftLine = {
  kind: 'product',
  productId: '',
  customName: '',
  isLot: false,
  quantity: '1',
  unitCost: '',
  vatAmount: '',
}

const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  confirmed: 'Confirmed',
  received: 'Received',
  cancelled: 'Cancelled',
}

const STATUS_BADGE_CLASS: Record<PurchaseOrderStatus, string> = {
  draft: 'badge',
  sent: 'badge badge-adjust',
  confirmed: 'badge badge-adjust',
  received: 'badge badge-in',
  cancelled: 'badge badge-out',
}

/**
 * Same fields either way, just a different starting point and submit
 * handler. Autosaves to `supplierDraftStorage` on every change (so a
 * half-typed supplier survives switching tabs or closing the dialog by
 * accident) and asks for confirmation before actually saving — same pattern
 * as ProductFormDialog, added for the same reason: a stray Enter or tap used
 * to save-and-close immediately, which caught people out.
 */
function SupplierForm({
  idPrefix,
  context,
  initial,
  addLabel,
  submitLabel,
  onSubmit,
  onCancel,
  draftStorage,
}: {
  idPrefix: string
  context: SupplierDraftContext
  initial: SupplierDraft
  /** Whether this is adding a brand new supplier or editing an existing one — only changes the confirm-step wording. */
  addLabel: boolean
  submitLabel: string
  onSubmit: (draft: SupplierDraft) => Promise<Result<Supplier>>
  onCancel: () => void
  draftStorage?: Storage
}) {
  const [restoredDraft] = useState<SupplierDraft | null>(() => loadSupplierDraftFor(context, draftStorage))
  const seed = restoredDraft ?? initial
  const [name, setName] = useState(seed.name)
  const [email, setEmail] = useState(seed.email)
  const [phone, setPhone] = useState(seed.phone)
  const [address, setAddress] = useState(seed.address)
  const [leadTimeDays, setLeadTimeDays] = useState(String(seed.leadTimeDays))
  const [contactName, setContactName] = useState(seed.contactName)
  const [notes, setNotes] = useState(seed.notes)
  // Whether this dialog opened with unsaved work already sitting in the
  // autosave — shown as a note with the option to start over instead.
  const [restored, setRestored] = useState(restoredDraft !== null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Set once the form has passed validation, holding the validated draft
  // while a "are you sure" confirmation is shown instead of saving right
  // away — see ProductFormDialog for the same pattern and reasoning.
  const [confirming, setConfirming] = useState<SupplierDraft | null>(null)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)

  // Autosaves on every change so the form survives a tab switch, the phone
  // backgrounding the PWA, or an accidental close — cleared only by a
  // successful save (below) or by signing out (see App.tsx).
  useEffect(() => {
    saveSupplierDraft(
      context,
      {
        name,
        email,
        phone,
        address,
        leadTimeDays: Math.max(0, Math.round(Number(leadTimeDays)) || 0),
        contactName,
        notes,
      },
      draftStorage,
    )
    // context is derived once from stable props (which supplier, if any, this
    // dialog opened for) — re-deriving it every render is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, email, phone, address, leadTimeDays, contactName, notes, draftStorage])

  useEffect(() => {
    if (confirming) confirmButtonRef.current?.focus()
  }, [confirming])

  const discardDraft = () => {
    clearSupplierDraft(draftStorage)
    setName(initial.name)
    setEmail(initial.email)
    setPhone(initial.phone)
    setAddress(initial.address)
    setLeadTimeDays(String(initial.leadTimeDays))
    setContactName(initial.contactName)
    setNotes(initial.notes)
    setRestored(false)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) return
    setError(null)
    setConfirming({
      name: trimmedName,
      email: email.trim(),
      phone: phone.trim(),
      address: address.trim(),
      leadTimeDays: Math.max(0, Math.round(Number(leadTimeDays)) || 0),
      contactName: contactName.trim(),
      notes: notes.trim(),
    })
  }

  const backToEditing = () => setConfirming(null)

  const confirmSave = async () => {
    if (!confirming) return
    setSaving(true)
    const result = await onSubmit(confirming)
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    clearSupplierDraft(draftStorage)
    setConfirming(null)
  }

  if (confirming) {
    return (
      <div className="form">
        <p className="dialog-message">
          {addLabel ? `Add "${confirming.name}" as a new supplier?` : `Save these changes to ${confirming.name}?`}
        </p>

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" className="button button-ghost" onClick={backToEditing} disabled={saving}>
            Back
          </button>
          <button
            type="button"
            className="button button-primary"
            ref={confirmButtonRef}
            onClick={confirmSave}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Yes, save'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <form className="form" onSubmit={submit}>
      {restored && (
        <p className="hint" role="status">
          Picked up where you left off — this wasn't saved yet.
        </p>
      )}

      <div className="field">
        <label htmlFor={`${idPrefix}-name`}>Supplier name</label>
        <input id={`${idPrefix}-name`} value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-contact`}>Contact person</label>
        <input id={`${idPrefix}-contact`} value={contactName} onChange={(e) => setContactName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-email`}>Email</label>
        <input id={`${idPrefix}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-phone`}>Phone</label>
        <input id={`${idPrefix}-phone`} value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-address`}>Address</label>
        <input id={`${idPrefix}-address`} value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-lead-time`}>Usual lead time (days)</label>
        <input
          id={`${idPrefix}-lead-time`}
          type="number"
          min={0}
          value={leadTimeDays}
          onChange={(e) => setLeadTimeDays(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-notes`}>Notes</label>
        <textarea
          id={`${idPrefix}-notes`}
          rows={2}
          placeholder="Payment terms, minimum order, anything worth remembering"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <div className="dialog-actions">
        {restored && (
          <button type="button" className="button button-ghost" onClick={discardDraft}>
            Discard draft
          </button>
        )}
        <button type="button" className="button button-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button button-primary">
          {submitLabel}
        </button>
      </div>
    </form>
  )
}

const emptyPoDraft = (defaultSupplierId: string, poNumber: string): PurchaseOrderDraft => ({
  supplierId: defaultSupplierId,
  poNumber,
  orderDate: new Date().toISOString().slice(0, 10),
  expectedDeliveryDate: '',
  notes: '',
  lines: [{ ...EMPTY_PO_LINE }],
  deliveryCost: '',
  buyersPremium: '',
  vatAmount: '',
})


interface NewPurchaseOrderInput {
  supplierId: string
  poNumber: string
  orderDate: string
  expectedDeliveryDate: string
  notes: string
  lines: Array<{
    productId?: string
    customName?: string
    isLot?: boolean
    quantity: number
    unitCost: number
    vatAmount?: number
  }>
  deliveryCost: number
  buyersPremium: number
  vatAmount: number
}

/**
 * Same autosave + confirm-before-save treatment as SupplierForm above.
 * There's only ever one "new PO" draft slot (no edit-PO form to disambiguate
 * against), so it isn't keyed to anything — see purchaseOrderDraftStorage.ts.
 *
 * Modelled on an auction-house invoice (John Pye Auctions' layout was the
 * concrete example): each line is either an existing catalogue product, a
 * one-off custom-named item not catalogued yet, or a mixed "lot" whose
 * actual contents aren't known until it's unboxed (see the "Unbox" flow on
 * a received PO, further down this file) — plus header-level delivery,
 * buyer's premium and VAT, since those apply to the order as a whole rather
 * than to one line.
 */
function NewPurchaseOrderForm({
  idPrefix,
  suppliers,
  products,
  purchaseOrders,
  onSubmit,
  onCancel,
  draftStorage,
}: {
  idPrefix: string
  suppliers: Supplier[]
  products: Product[]
  purchaseOrders: PurchaseOrder[]
  onSubmit: (input: NewPurchaseOrderInput) => Promise<Result<PurchaseOrder>>
  onCancel: () => void
  draftStorage?: Storage
}) {
  const fallback = () => emptyPoDraft(suppliers[0]?.id ?? '', nextPoNumber(purchaseOrders))
  const [restoredDraft] = useState<PurchaseOrderDraft | null>(() => loadPurchaseOrderDraft(draftStorage))
  const seed = restoredDraft ?? fallback()
  const [supplierId, setSupplierId] = useState(seed.supplierId)
  const [poNumber, setPoNumber] = useState(seed.poNumber)
  const [orderDate, setOrderDate] = useState(seed.orderDate)
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(seed.expectedDeliveryDate)
  const [notes, setNotes] = useState(seed.notes)
  const [lines, setLines] = useState<PurchaseOrderDraftLine[]>(seed.lines)
  const [deliveryCost, setDeliveryCost] = useState(seed.deliveryCost)
  const [buyersPremium, setBuyersPremium] = useState(seed.buyersPremium)
  const [vatAmount, setVatAmount] = useState(seed.vatAmount)
  const [restored, setRestored] = useState(restoredDraft !== null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState<NewPurchaseOrderInput | null>(null)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)

  const setLine = (index: number, patch: Partial<PurchaseOrderDraftLine>) =>
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)))

  const setLineKind = (index: number, kind: PurchaseOrderDraftLineKind) =>
    setLine(index, {
      kind,
      productId: kind === 'product' ? lines[index].productId : '',
      isLot: kind === 'lot',
      customName: kind === 'product' ? '' : lines[index].customName,
    })

  const addLine = () => setLines((current) => [...current, { ...EMPTY_PO_LINE }])
  const removeLine = (index: number) => setLines((current) => current.filter((_, i) => i !== index))

  const usableLines = lines.filter((line) => {
    const hasSource = line.productId !== '' || line.customName.trim() !== ''
    return hasSource && Number(line.quantity) > 0
  })
  const subtotal = usableLines.reduce((sum, line) => sum + Number(line.quantity) * (Number(line.unitCost) || 0), 0)
  const deliveryCostNum = Math.max(0, Number(deliveryCost) || 0)
  const buyersPremiumNum = Math.max(0, Number(buyersPremium) || 0)
  const vatAmountNum = Math.max(0, Number(vatAmount) || 0)
  const grandTotal = calculatePOGrandTotal({
    subtotal,
    deliveryCost: deliveryCostNum,
    buyersPremium: buyersPremiumNum,
    vatAmount: vatAmountNum,
  })
  const supplierName = suppliers.find((s) => s.id === supplierId)?.name ?? ''

  // Autosaves on every change — same lifecycle as the supplier form and
  // ProductFormDialog: survives a tab switch or an accidental close, cleared
  // only by a successful "Create draft PO" or by signing out (see App.tsx).
  useEffect(() => {
    savePurchaseOrderDraft(
      { supplierId, poNumber, orderDate, expectedDeliveryDate, notes, lines, deliveryCost, buyersPremium, vatAmount },
      draftStorage,
    )
  }, [supplierId, poNumber, orderDate, expectedDeliveryDate, notes, lines, deliveryCost, buyersPremium, vatAmount, draftStorage])

  useEffect(() => {
    if (confirming) confirmButtonRef.current?.focus()
  }, [confirming])

  const discardDraft = () => {
    clearPurchaseOrderDraft(draftStorage)
    const start = fallback()
    setSupplierId(start.supplierId)
    setPoNumber(start.poNumber)
    setOrderDate(start.orderDate)
    setExpectedDeliveryDate(start.expectedDeliveryDate)
    setNotes(start.notes)
    setLines(start.lines)
    setDeliveryCost(start.deliveryCost)
    setBuyersPremium(start.buyersPremium)
    setVatAmount(start.vatAmount)
    setRestored(false)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!supplierId || usableLines.length === 0) return
    setError(null)
    setConfirming({
      supplierId,
      poNumber: poNumber.trim(),
      orderDate,
      expectedDeliveryDate,
      notes: notes.trim(),
      lines: usableLines.map((line) => {
        const quantity = Math.max(1, Math.round(Number(line.quantity)))
        const unitCost = Math.max(0, Number(line.unitCost) || 0)
        const lineVat = line.vatAmount.trim() === '' ? undefined : Math.max(0, Number(line.vatAmount) || 0)
        return line.productId
          ? { productId: line.productId, quantity, unitCost, vatAmount: lineVat }
          : { customName: line.customName.trim(), isLot: line.isLot, quantity, unitCost, vatAmount: lineVat }
      }),
      deliveryCost: deliveryCostNum,
      buyersPremium: buyersPremiumNum,
      vatAmount: vatAmountNum,
    })
  }

  const backToEditing = () => setConfirming(null)

  const confirmSave = async () => {
    if (!confirming) return
    setSaving(true)
    const result = await onSubmit(confirming)
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    clearPurchaseOrderDraft(draftStorage)
    setConfirming(null)
  }

  if (confirming) {
    const itemCount = confirming.lines.length
    return (
      <div className="form">
        <p className="dialog-message">
          {`Create ${confirming.poNumber || 'this purchase order'} for ${supplierName || 'this supplier'} — ${itemCount} item${itemCount === 1 ? '' : 's'}, grand total ${formatCurrency(grandTotal)}?`}
        </p>

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" className="button button-ghost" onClick={backToEditing} disabled={saving}>
            Back
          </button>
          <button
            type="button"
            className="button button-primary"
            ref={confirmButtonRef}
            onClick={confirmSave}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Yes, create'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <form className="form" onSubmit={submit}>
      {restored && (
        <p className="hint" role="status">
          Picked up where you left off — this wasn't saved yet.
        </p>
      )}

      <div className="field">
        <label htmlFor={`${idPrefix}-supplier`}>Supplier</label>
        <select id={`${idPrefix}-supplier`} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
          <option value="" disabled>
            Choose a supplier…
          </option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div className="toolbar-actions">
        <div className="field">
          <label htmlFor={`${idPrefix}-po-number`}>PO number</label>
          <input
            id={`${idPrefix}-po-number`}
            value={poNumber}
            onChange={(e) => setPoNumber(e.target.value)}
            placeholder="PO-0001"
          />
        </div>

        <div className="field">
          <label htmlFor={`${idPrefix}-order-date`}>Order date</label>
          <input id={`${idPrefix}-order-date`} type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor={`${idPrefix}-expected`}>Expected delivery date</label>
          <input
            id={`${idPrefix}-expected`}
            type="date"
            value={expectedDeliveryDate}
            onChange={(e) => setExpectedDeliveryDate(e.target.value)}
          />
        </div>
      </div>

      <fieldset className="field">
        <legend>Items ordered</legend>
        {lines.map((line, index) => {
          const kind = line.kind
          return (
            <div key={index} className="toolbar-actions" style={{ marginBottom: '.5rem', flexWrap: 'wrap' }}>
              <select
                aria-label="Line type"
                value={kind}
                onChange={(e) => setLineKind(index, e.target.value as PurchaseOrderDraftLineKind)}
                style={{ width: '9rem' }}
              >
                <option value="product">Existing product</option>
                <option value="custom">Custom item</option>
                <option value="lot">Mixed lot (unbox later)</option>
              </select>

              {kind === 'product' ? (
                <select
                  aria-label="Product"
                  value={line.productId}
                  onChange={(e) => {
                    const product = products.find((p) => p.id === e.target.value)
                    setLine(index, {
                      productId: e.target.value,
                      unitCost: product ? String(product.cost) : line.unitCost,
                    })
                  }}
                >
                  <option value="">Choose a product…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  aria-label={kind === 'lot' ? 'Lot description' : 'Item name'}
                  value={line.customName}
                  onChange={(e) => setLine(index, { customName: e.target.value })}
                  placeholder={
                    kind === 'lot'
                      ? 'e.g. Quantity of health & beauty items to include Remington XR1500'
                      : 'Item name'
                  }
                  style={{ flex: '1 1 14rem' }}
                />
              )}

              <input
                aria-label="Quantity"
                type="number"
                min={1}
                value={line.quantity}
                onChange={(e) => setLine(index, { quantity: e.target.value })}
                style={{ width: '5rem' }}
              />
              <input
                aria-label={kind === 'lot' ? 'Hammer / lot price' : 'Unit cost'}
                type="number"
                min={0}
                step="0.01"
                value={line.unitCost}
                onChange={(e) => setLine(index, { unitCost: e.target.value })}
                style={{ width: '6rem' }}
                title={kind === 'lot' ? 'What you paid for the whole lot' : 'Cost per unit'}
              />
              <input
                aria-label="VAT for this line (optional)"
                type="number"
                min={0}
                step="0.01"
                value={line.vatAmount}
                onChange={(e) => setLine(index, { vatAmount: e.target.value })}
                placeholder="VAT"
                style={{ width: '5rem' }}
              />
              {lines.length > 1 && (
                <button type="button" className="button button-ghost" aria-label="Remove line" onClick={() => removeLine(index)}>
                  <CloseIcon />
                </button>
              )}
            </div>
          )
        })}
        <button type="button" className="button button-ghost" onClick={addLine}>
          Add another item
        </button>
      </fieldset>

      <div className="toolbar-actions">
        <div className="field">
          <label htmlFor={`${idPrefix}-delivery`}>Delivery</label>
          <input
            id={`${idPrefix}-delivery`}
            type="number"
            min={0}
            step="0.01"
            value={deliveryCost}
            onChange={(e) => setDeliveryCost(e.target.value)}
            style={{ width: '6rem' }}
          />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-premium`}>Buyer's premium</label>
          <input
            id={`${idPrefix}-premium`}
            type="number"
            min={0}
            step="0.01"
            value={buyersPremium}
            onChange={(e) => setBuyersPremium(e.target.value)}
            style={{ width: '6rem' }}
          />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-vat`}>Total VAT</label>
          <input
            id={`${idPrefix}-vat`}
            type="number"
            min={0}
            step="0.01"
            value={vatAmount}
            onChange={(e) => setVatAmount(e.target.value)}
            style={{ width: '6rem' }}
          />
        </div>
      </div>

      <p className="muted">Subtotal: {formatCurrency(subtotal)}</p>
      <p className="muted">
        <strong>Grand total: {formatCurrency(grandTotal)}</strong>
      </p>

      <div className="field">
        <label htmlFor={`${idPrefix}-notes`}>Notes (optional)</label>
        <input id={`${idPrefix}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <div className="dialog-actions">
        {restored && (
          <button type="button" className="button button-ghost" onClick={discardDraft}>
            Discard draft
          </button>
        )}
        <button type="button" className="button button-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button button-primary" disabled={!supplierId || usableLines.length === 0}>
          Create draft PO
        </button>
      </div>
    </form>
  )
}

/**
 * Manager-only. Suppliers you buy from, and the purchase orders you send
 * them — deliberately kept to the simple loop a small shop actually needs:
 * add a supplier, draft a PO against it, walk it through sent → confirmed →
 * received (which adds the stock), or cancel it. No per-line partial
 * receiving and no supplier-specific cost catalogue yet — a PO's line cost
 * is just typed in each time, prefilled from the product's own cost as a
 * starting point. Both are easy to add later if the simple version isn't
 * enough; see the project notes for why this was cut for the first pass.
 */
interface UnboxItemDraft {
  mode: 'existing' | 'new'
  productId: string
  newSku: string
  newName: string
  newCategory: string
  newLocation: string
  newBarcode: string
  quantity: string
  allocatedCost: string
}

const EMPTY_UNBOX_ITEM: UnboxItemDraft = {
  mode: 'existing',
  productId: '',
  newSku: '',
  newName: '',
  newCategory: '',
  newLocation: '',
  newBarcode: '',
  quantity: '1',
  allocatedCost: '',
}

/**
 * Shown once a PO with a mixed-lot line has been received and physically
 * unboxed. Mason's own case (job lots bought at auction where you don't
 * know every item inside until you open it): break the lot into the real
 * products it turned out to contain, creating brand-new catalogue products
 * on the spot for anything not already in the catalogue, and split the
 * lot's own cost across them. Can be run more than once for the same lot —
 * e.g. unboxing it over a couple of sessions — each run just adds more
 * items to what's already recorded against this line.
 */
function UnboxLotDialog({
  line,
  products,
  onSubmit,
  onCancel,
}: {
  po: PurchaseOrder
  line: PurchaseOrderLine
  products: Product[]
  onSubmit: (items: UnboxedLineItemInput[]) => Promise<Result<PurchaseOrder>>
  onCancel: () => void
}) {
  const [items, setItems] = useState<UnboxItemDraft[]>([{ ...EMPTY_UNBOX_ITEM }])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const setItem = (index: number, patch: Partial<UnboxItemDraft>) =>
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  const addItem = () => setItems((current) => [...current, { ...EMPTY_UNBOX_ITEM }])
  const removeItem = (index: number) => setItems((current) => current.filter((_, i) => i !== index))

  const alreadyAllocated = (line.unboxedInto ?? []).reduce((sum, u) => sum + u.allocatedCost, 0)
  const runningTotal = items.reduce((sum, item) => sum + (Number(item.allocatedCost) || 0), 0)
  const lotCost = line.lineTotal

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)

    const usable = items.filter(
      (item) => (item.mode === 'existing' ? item.productId : item.newName.trim()) && Number(item.quantity) > 0,
    )
    if (usable.length === 0) {
      setError('Add at least one item found in the lot.')
      return
    }

    const payload: UnboxedLineItemInput[] = usable.map((item) => {
      const quantity = Math.max(1, Math.round(Number(item.quantity)))
      const allocatedCost = Math.max(0, Number(item.allocatedCost) || 0)
      if (item.mode === 'existing') {
        return { productId: item.productId, quantity, allocatedCost }
      }
      return {
        newProduct: {
          sku: item.newSku.trim() || nextSku(products),
          name: item.newName.trim(),
          category: item.newCategory.trim(),
          location: item.newLocation.trim(),
          barcode: item.newBarcode.trim(),
        },
        quantity,
        allocatedCost,
      }
    })

    setSaving(true)
    const result = await onSubmit(payload)
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setItems([{ ...EMPTY_UNBOX_ITEM }])
  }

  return (
    <form className="form" onSubmit={submit}>
      <p className="dialog-message">
        {`"${line.name}" cost ${formatCurrency(lotCost)} as one lot.`}
        {alreadyAllocated > 0 && ` ${formatCurrency(alreadyAllocated)} already allocated to items found so far.`}
        {' '}List what you actually found once you unboxed it — split the cost across them however makes sense; it
        doesn't have to add up to the exact penny.
      </p>

      <fieldset className="field">
        <legend>Items found in this lot</legend>
        {items.map((item, index) => (
          <div key={index} className="toolbar-actions" style={{ marginBottom: '.5rem', flexWrap: 'wrap' }}>
            <select
              aria-label="Source"
              value={item.mode}
              onChange={(e) => setItem(index, { mode: e.target.value as 'existing' | 'new' })}
              style={{ width: '9rem' }}
            >
              <option value="existing">Existing product</option>
              <option value="new">New product</option>
            </select>

            {item.mode === 'existing' ? (
              <select
                aria-label="Product"
                value={item.productId}
                onChange={(e) => setItem(index, { productId: e.target.value })}
              >
                <option value="">Choose a product…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.sku})
                  </option>
                ))}
              </select>
            ) : (
              <>
                <input
                  aria-label="New product name"
                  value={item.newName}
                  onChange={(e) => setItem(index, { newName: e.target.value })}
                  placeholder="Product name"
                  style={{ flex: '1 1 10rem' }}
                />
                <input
                  aria-label="New product SKU (optional)"
                  value={item.newSku}
                  onChange={(e) => setItem(index, { newSku: e.target.value })}
                  placeholder="SKU (auto if blank)"
                  style={{ width: '8rem' }}
                />
                <input
                  aria-label="Category (optional)"
                  value={item.newCategory}
                  onChange={(e) => setItem(index, { newCategory: e.target.value })}
                  placeholder="Category"
                  style={{ width: '8rem' }}
                />
                <input
                  aria-label="Location (optional)"
                  value={item.newLocation}
                  onChange={(e) => setItem(index, { newLocation: e.target.value })}
                  placeholder="Location"
                  style={{ width: '8rem' }}
                />
              </>
            )}

            <input
              aria-label="Quantity"
              type="number"
              min={1}
              value={item.quantity}
              onChange={(e) => setItem(index, { quantity: e.target.value })}
              style={{ width: '5rem' }}
            />
            <input
              aria-label="Allocated cost"
              type="number"
              min={0}
              step="0.01"
              value={item.allocatedCost}
              onChange={(e) => setItem(index, { allocatedCost: e.target.value })}
              placeholder="Cost"
              style={{ width: '6rem' }}
            />
            {items.length > 1 && (
              <button type="button" className="button button-ghost" aria-label="Remove item" onClick={() => removeItem(index)}>
                <CloseIcon />
              </button>
            )}
          </div>
        ))}
        <button type="button" className="button button-ghost" onClick={addItem}>
          Add another item
        </button>
      </fieldset>

      <p className="muted">
        Allocated so far: {formatCurrency(runningTotal)} of {formatCurrency(lotCost)} lot cost
      </p>

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <div className="dialog-actions">
        <button type="button" className="button button-ghost" onClick={onCancel} disabled={saving}>
          Done
        </button>
        <button type="submit" className="button button-primary" disabled={saving}>
          {saving ? 'Adding to stock…' : 'Add to stock'}
        </button>
      </div>
    </form>
  )
}

export function SuppliersScreen({ inventory, products, supplierDraftStorage, purchaseOrderDraftStorage }: SuppliersScreenProps) {
  const idPrefix = useId()
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null)
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [addingSupplier, setAddingSupplier] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [creatingPo, setCreatingPo] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [unboxing, setUnboxing] = useState<{ po: PurchaseOrder; line: PurchaseOrderLine } | null>(null)

  const refreshSuppliers = async () => setSuppliers(await inventory.listSuppliers())
  const refreshPurchaseOrders = async () => setPurchaseOrders(await inventory.listPurchaseOrders())

  useEffect(() => {
    void refreshSuppliers()
    void refreshPurchaseOrders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const productById = new Map(products.map((p) => [p.id, p]))

  return (
    <div className="screen">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="panel">
        <header className="panel-header">
          <h2>Suppliers</h2>
        </header>

        {suppliers === null ? (
          <p className="muted">Loading…</p>
        ) : suppliers.length === 0 ? (
          <p className="empty">No suppliers yet — add one below, then you can order stock from them.</p>
        ) : (
          <ul className="plain-list" data-testid="supplier-list">
            {suppliers.map((supplier) => (
              <li key={supplier.id} className="low-stock-item">
                <span className="low-stock-name">{supplier.name}</span>
                <span className="muted">{supplier.contactName || supplier.email || 'No contact set'}</span>
                <span className="muted">{supplier.leadTimeDays > 0 ? `${supplier.leadTimeDays}d lead time` : ''}</span>
                <div className="toolbar-actions">
                  <button type="button" className="button button-ghost" onClick={() => setEditingSupplier(supplier)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="button button-ghost"
                    aria-label={`Delete ${supplier.name}`}
                    onClick={async () => {
                      const result = await inventory.deleteSupplier(supplier.id)
                      if (!result.ok) setError(result.error)
                      else {
                        await refreshSuppliers()
                        await refreshPurchaseOrders()
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="dialog-actions">
          <button type="button" className="button button-primary" onClick={() => setAddingSupplier(true)}>
            Add a supplier
          </button>
        </div>
      </section>

      <section className="panel">
        <header className="panel-header">
          <h2>Purchase orders</h2>
        </header>

        {purchaseOrders === null ? (
          <p className="muted">Loading…</p>
        ) : purchaseOrders.length === 0 ? (
          <p className="empty">No purchase orders yet.</p>
        ) : (
          <ul className="plain-list" data-testid="purchase-order-list">
            {purchaseOrders.map((po) => (
              <li key={po.id} className="low-stock-item">
                <span className="low-stock-name">
                  {po.poNumber || po.supplierName} — {po.supplierName}
                </span>
                <span className={STATUS_BADGE_CLASS[po.status]}>{STATUS_LABELS[po.status]}</span>
                <span className="mono" title="Grand total (goods + delivery + buyer's premium + VAT)">
                  {formatCurrency(po.grandTotal || po.subtotal)}
                </span>
                <span className="muted">
                  {po.orderDate ? `Ordered ${po.orderDate}` : 'No order date'}
                  {po.expectedDeliveryDate ? ` · Expected ${po.expectedDeliveryDate}` : ''}
                </span>
                {(po.deliveryCost > 0 || po.buyersPremium > 0 || po.vatAmount > 0) && (
                  <span className="muted">
                    Goods {formatCurrency(po.subtotal)}
                    {po.deliveryCost > 0 ? ` + delivery ${formatCurrency(po.deliveryCost)}` : ''}
                    {po.buyersPremium > 0 ? ` + premium ${formatCurrency(po.buyersPremium)}` : ''}
                    {po.vatAmount > 0 ? ` + VAT ${formatCurrency(po.vatAmount)}` : ''}
                  </span>
                )}
                <ul className="plain-list">
                  {po.lines.map((line) => {
                    const product = line.productId ? productById.get(line.productId) : undefined
                    const label = line.productId ? (product?.sku ?? line.sku) : line.name
                    return (
                      <li key={line.id} className="muted">
                        {line.quantity}× {label}
                        {line.isLot && (
                          <>
                            {' '}
                            <span className="badge">Lot</span>
                            {line.unboxedInto && line.unboxedInto.length > 0 && (
                              <span>
                                {' '}
                                — unboxed into{' '}
                                {line.unboxedInto.map((u) => `${u.quantity}× ${u.name}`).join(', ')}
                              </span>
                            )}
                          </>
                        )}
                        {line.isLot && po.status === 'received' && (
                          <>
                            {' '}
                            <button
                              type="button"
                              className="button button-ghost"
                              onClick={() => setUnboxing({ po, line })}
                            >
                              {line.unboxedInto && line.unboxedInto.length > 0 ? 'Unbox more' : 'Unbox this lot'}
                            </button>
                          </>
                        )}
                      </li>
                    )
                  })}
                </ul>
                <div className="toolbar-actions">
                  {po.status === 'draft' && (
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={busyId === po.id}
                      onClick={async () => {
                        setBusyId(po.id)
                        const result = await inventory.sendPurchaseOrder(po.id)
                        if (!result.ok) setError(result.error)
                        else await refreshPurchaseOrders()
                        setBusyId(null)
                      }}
                    >
                      Send
                    </button>
                  )}
                  {po.status === 'sent' && (
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={busyId === po.id}
                      onClick={async () => {
                        setBusyId(po.id)
                        const result = await inventory.confirmPurchaseOrder(po.id)
                        if (!result.ok) setError(result.error)
                        else await refreshPurchaseOrders()
                        setBusyId(null)
                      }}
                    >
                      Confirm
                    </button>
                  )}
                  {po.status === 'confirmed' && (
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={busyId === po.id}
                      title="Adds this PO's full ordered quantity to stock right away."
                      onClick={async () => {
                        setBusyId(po.id)
                        const lineQuantities = new Map(po.lines.map((line) => [line.id, line.quantity]))
                        const result = await inventory.receivePurchaseOrder(po.id, lineQuantities)
                        if (!result.ok) setError(result.error)
                        else await refreshPurchaseOrders()
                        setBusyId(null)
                      }}
                    >
                      Mark received (adds stock)
                    </button>
                  )}
                  {(po.status === 'draft' || po.status === 'sent' || po.status === 'confirmed') && (
                    <button
                      type="button"
                      className="button button-ghost"
                      disabled={busyId === po.id}
                      onClick={async () => {
                        setBusyId(po.id)
                        const result = await inventory.cancelPurchaseOrder(po.id)
                        if (!result.ok) setError(result.error)
                        else await refreshPurchaseOrders()
                        setBusyId(null)
                      }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="dialog-actions">
          <button
            type="button"
            className="button button-primary"
            disabled={!suppliers || suppliers.length === 0}
            onClick={() => setCreatingPo(true)}
          >
            New purchase order
          </button>
          {suppliers?.length === 0 && <span className="muted">Add a supplier first.</span>}
        </div>
      </section>

      {addingSupplier && (
        <Dialog title="Add a supplier" onClose={() => setAddingSupplier(false)}>
          <SupplierForm
            idPrefix={`${idPrefix}-add-supplier`}
            context={{ kind: 'new' }}
            initial={EMPTY_SUPPLIER_DRAFT}
            addLabel
            submitLabel="Add supplier"
            onCancel={() => setAddingSupplier(false)}
            draftStorage={supplierDraftStorage}
            onSubmit={async (draft) => {
              const result = await inventory.createSupplier(draft)
              if (result.ok) {
                setAddingSupplier(false)
                await refreshSuppliers()
              }
              return result
            }}
          />
        </Dialog>
      )}

      {editingSupplier && (
        <Dialog title={`Edit ${editingSupplier.name}`} onClose={() => setEditingSupplier(null)}>
          <SupplierForm
            idPrefix={`${idPrefix}-edit-supplier`}
            context={{ kind: 'edit', supplierId: editingSupplier.id }}
            initial={editingSupplier}
            addLabel={false}
            submitLabel="Save changes"
            onCancel={() => setEditingSupplier(null)}
            draftStorage={supplierDraftStorage}
            onSubmit={async (draft) => {
              const result = await inventory.updateSupplier(editingSupplier.id, draft)
              if (result.ok) {
                setEditingSupplier(null)
                await refreshSuppliers()
                await refreshPurchaseOrders()
              }
              return result
            }}
          />
        </Dialog>
      )}

      {creatingPo && suppliers && (
        <Dialog title="New purchase order" onClose={() => setCreatingPo(false)}>
          <NewPurchaseOrderForm
            idPrefix={`${idPrefix}-new-po`}
            suppliers={suppliers}
            products={products}
            purchaseOrders={purchaseOrders ?? []}
            onCancel={() => setCreatingPo(false)}
            draftStorage={purchaseOrderDraftStorage}
            onSubmit={async (input) => {
              const result = await inventory.createPurchaseOrder(input)
              if (result.ok) {
                setCreatingPo(false)
                await refreshPurchaseOrders()
              }
              return result
            }}
          />
        </Dialog>
      )}

      {unboxing && (
        <Dialog title={`Unbox "${unboxing.line.name}"`} onClose={() => setUnboxing(null)}>
          <UnboxLotDialog
            po={unboxing.po}
            line={unboxing.line}
            products={products}
            onSubmit={async (items) => {
              const result = await inventory.unboxPurchaseOrderLine(unboxing.po.id, unboxing.line.id, items)
              if (result.ok) {
                await refreshPurchaseOrders()
                const updatedLine = result.value.lines.find((l) => l.id === unboxing.line.id)
                if (updatedLine) setUnboxing({ po: result.value, line: updatedLine })
              }
              return result
            }}
            onCancel={() => setUnboxing(null)}
          />
        </Dialog>
      )}
    </div>
  )
}
