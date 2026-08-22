import { useEffect, useId, useState, type FormEvent } from 'react'
import type { Inventory } from '../useInventory'
import type { Product } from '../../domain/types'
import type { PurchaseOrder, PurchaseOrderStatus, Supplier, SupplierDraft } from '../../domain/suppliers'
import { Dialog } from '../components/Dialog'
import { formatCurrency } from '../format'

export interface SuppliersScreenProps {
  inventory: Inventory
  products: Product[]
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

/** Same fields either way, just a different starting point and submit handler. */
function SupplierForm({
  idPrefix,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  idPrefix: string
  initial: SupplierDraft
  submitLabel: string
  onSubmit: (draft: SupplierDraft) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial.name)
  const [email, setEmail] = useState(initial.email)
  const [phone, setPhone] = useState(initial.phone)
  const [address, setAddress] = useState(initial.address)
  const [leadTimeDays, setLeadTimeDays] = useState(String(initial.leadTimeDays))
  const [contactName, setContactName] = useState(initial.contactName)
  const [notes, setNotes] = useState(initial.notes)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) return
    onSubmit({
      name: trimmedName,
      email: email.trim(),
      phone: phone.trim(),
      address: address.trim(),
      leadTimeDays: Math.max(0, Math.round(Number(leadTimeDays)) || 0),
      contactName: contactName.trim(),
      notes: notes.trim(),
    })
  }

  return (
    <form className="form" onSubmit={submit}>
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
      <div className="dialog-actions">
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

interface NewPoLine {
  productId: string
  quantity: string
  unitCost: string
}

function NewPurchaseOrderForm({
  idPrefix,
  suppliers,
  products,
  onSubmit,
  onCancel,
}: {
  idPrefix: string
  suppliers: Supplier[]
  products: Product[]
  onSubmit: (input: {
    supplierId: string
    expectedDeliveryDate: string
    notes: string
    lines: { productId: string; quantity: number; unitCost: number }[]
  }) => void
  onCancel: () => void
}) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '')
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<NewPoLine[]>([{ productId: '', quantity: '1', unitCost: '' }])

  const setLine = (index: number, patch: Partial<NewPoLine>) =>
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)))

  const addLine = () => setLines((current) => [...current, { productId: '', quantity: '1', unitCost: '' }])
  const removeLine = (index: number) => setLines((current) => current.filter((_, i) => i !== index))

  const usableLines = lines.filter((line) => line.productId && Number(line.quantity) > 0)
  const subtotal = usableLines.reduce((sum, line) => sum + Number(line.quantity) * (Number(line.unitCost) || 0), 0)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!supplierId || usableLines.length === 0) return
    onSubmit({
      supplierId,
      expectedDeliveryDate,
      notes: notes.trim(),
      lines: usableLines.map((line) => ({
        productId: line.productId,
        quantity: Math.max(1, Math.round(Number(line.quantity))),
        unitCost: Math.max(0, Number(line.unitCost) || 0),
      })),
    })
  }

  return (
    <form className="form" onSubmit={submit}>
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

      <div className="field">
        <label htmlFor={`${idPrefix}-expected`}>Expected delivery date</label>
        <input
          id={`${idPrefix}-expected`}
          type="date"
          value={expectedDeliveryDate}
          onChange={(e) => setExpectedDeliveryDate(e.target.value)}
        />
      </div>

      <fieldset className="field">
        <legend>Items to order</legend>
        {lines.map((line, index) => (
          <div key={index} className="toolbar-actions" style={{ marginBottom: '.5rem' }}>
            <select
              aria-label="Product"
              value={line.productId}
              onChange={(e) => {
                const product = products.find((p) => p.id === e.target.value)
                setLine(index, { productId: e.target.value, unitCost: product ? String(product.cost) : line.unitCost })
              }}
            >
              <option value="">Choose a product…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.sku})
                </option>
              ))}
            </select>
            <input
              aria-label="Quantity"
              type="number"
              min={1}
              value={line.quantity}
              onChange={(e) => setLine(index, { quantity: e.target.value })}
              style={{ width: '5rem' }}
            />
            <input
              aria-label="Unit cost"
              type="number"
              min={0}
              step="0.01"
              value={line.unitCost}
              onChange={(e) => setLine(index, { unitCost: e.target.value })}
              style={{ width: '6rem' }}
            />
            {lines.length > 1 && (
              <button type="button" className="button button-ghost" aria-label="Remove line" onClick={() => removeLine(index)}>
                ✕
              </button>
            )}
          </div>
        ))}
        <button type="button" className="button button-ghost" onClick={addLine}>
          Add another item
        </button>
      </fieldset>

      <p className="muted">Subtotal: {formatCurrency(subtotal)}</p>

      <div className="field">
        <label htmlFor={`${idPrefix}-notes`}>Notes (optional)</label>
        <input id={`${idPrefix}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="dialog-actions">
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
export function SuppliersScreen({ inventory, products }: SuppliersScreenProps) {
  const idPrefix = useId()
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null)
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [addingSupplier, setAddingSupplier] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [creatingPo, setCreatingPo] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

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
                <span className="low-stock-name">{po.supplierName}</span>
                <span className={STATUS_BADGE_CLASS[po.status]}>{STATUS_LABELS[po.status]}</span>
                <span className="mono">{formatCurrency(po.subtotal)}</span>
                <span className="muted">
                  {po.expectedDeliveryDate ? `Expected ${po.expectedDeliveryDate}` : 'No expected date'}
                </span>
                <span className="muted">
                  {po.lines
                    .map((line) => `${line.quantity}× ${productById.get(line.productId)?.sku ?? line.sku}`)
                    .join(', ')}
                </span>
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
            initial={EMPTY_SUPPLIER_DRAFT}
            submitLabel="Add supplier"
            onCancel={() => setAddingSupplier(false)}
            onSubmit={async (draft) => {
              const result = await inventory.createSupplier(draft)
              if (!result.ok) setError(result.error)
              else {
                setAddingSupplier(false)
                await refreshSuppliers()
              }
            }}
          />
        </Dialog>
      )}

      {editingSupplier && (
        <Dialog title={`Edit ${editingSupplier.name}`} onClose={() => setEditingSupplier(null)}>
          <SupplierForm
            idPrefix={`${idPrefix}-edit-supplier`}
            initial={editingSupplier}
            submitLabel="Save changes"
            onCancel={() => setEditingSupplier(null)}
            onSubmit={async (draft) => {
              const result = await inventory.updateSupplier(editingSupplier.id, draft)
              if (!result.ok) setError(result.error)
              else {
                setEditingSupplier(null)
                await refreshSuppliers()
                await refreshPurchaseOrders()
              }
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
            onCancel={() => setCreatingPo(false)}
            onSubmit={async (input) => {
              const result = await inventory.createPurchaseOrder(input)
              if (!result.ok) setError(result.error)
              else {
                setCreatingPo(false)
                await refreshPurchaseOrders()
              }
            }}
          />
        </Dialog>
      )}
    </div>
  )
}
