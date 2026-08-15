import { useId } from 'react'
import type { SaleFeesDraft } from '../../domain/sales'
import { DELIVERY_PAID_BY_LABELS, type DeliveryPaidBy } from '../../domain/types'

const DELIVERY_PAID_BY_OPTIONS: DeliveryPaidBy[] = ['seller', 'buyer']

export interface SaleFeesFieldsProps {
  value: SaleFeesDraft
  onChange: (next: SaleFeesDraft) => void
}

/**
 * The order-level marketplace fees a checkout or a sale edit can carry on
 * top of the item price — a Vinted/eBay-style "Buyer Protection" add-on,
 * delivery (which may have been paid by either side), VAT and ad spend,
 * plus the buyer's own order total for reconciliation. Shared between
 * `CheckoutScreen` and `HistoryScreen`'s sale-edit dialog so both stay in
 * sync as this list of fees evolves.
 *
 * Every field is optional — a blank amount is treated as 0, not an error —
 * so a plain cash or walk-in sale with none of these can just skip the
 * section entirely.
 */
export function SaleFeesFields({ value, onChange }: SaleFeesFieldsProps) {
  const idPrefix = useId()
  const set = <K extends keyof SaleFeesDraft>(key: K, next: SaleFeesDraft[K]) =>
    onChange({ ...value, [key]: next })

  return (
    <div className="sale-fees-fields">
      <h3>Marketplace fees</h3>
      <p className="muted">
        Optional — only relevant for a sale through a marketplace that charges these on top of the item price (e.g.
        Vinted's Buyer Protection fee). Every amount here comes off profit, except delivery when the buyer paid for
        it themselves.
      </p>

      <div className="field-row">
        <div className="field">
          <label htmlFor={`${idPrefix}-buyer-protection`}>Buyer protection fee</label>
          <input
            id={`${idPrefix}-buyer-protection`}
            type="number"
            min={0}
            step={0.01}
            inputMode="decimal"
            value={value.buyerProtectionFee}
            placeholder="0.00"
            onChange={(event) => set('buyerProtectionFee', event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-vat`}>VAT</label>
          <input
            id={`${idPrefix}-vat`}
            type="number"
            min={0}
            step={0.01}
            inputMode="decimal"
            value={value.vat}
            placeholder="0.00"
            onChange={(event) => set('vat', event.target.value)}
          />
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor={`${idPrefix}-delivery-cost`}>Delivery cost</label>
          <input
            id={`${idPrefix}-delivery-cost`}
            type="number"
            min={0}
            step={0.01}
            inputMode="decimal"
            value={value.deliveryCost}
            placeholder="0.00"
            onChange={(event) => set('deliveryCost', event.target.value)}
          />
        </div>
        <div className="field">
          <span>Who paid for delivery?</span>
          <div className="channel-picker">
            {DELIVERY_PAID_BY_OPTIONS.map((who) => (
              <button
                key={who}
                type="button"
                className={`button chip-button ${value.deliveryPaidBy === who ? 'chip-button-active' : ''}`}
                aria-pressed={value.deliveryPaidBy === who}
                onClick={() => set('deliveryPaidBy', who)}
              >
                {DELIVERY_PAID_BY_LABELS[who]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor={`${idPrefix}-advertising`}>Advertising cost</label>
          <input
            id={`${idPrefix}-advertising`}
            type="number"
            min={0}
            step={0.01}
            inputMode="decimal"
            value={value.advertisingCost}
            placeholder="0.00"
            onChange={(event) => set('advertisingCost', event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-order-total`}>Order total (what the buyer paid)</label>
          <input
            id={`${idPrefix}-order-total`}
            type="number"
            min={0}
            step={0.01}
            inputMode="decimal"
            value={value.orderTotal}
            placeholder="From the marketplace's order summary"
            onChange={(event) => set('orderTotal', event.target.value)}
          />
          <span className="hint">For your own records only — it doesn't change the profit figure below.</span>
        </div>
      </div>
    </div>
  )
}
