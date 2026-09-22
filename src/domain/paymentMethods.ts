import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type PaymentMethod } from './types'

/** A payment method as CountRoom Register stores it in
 * account_settings.payment_methods. Only the fields Inventory needs. */
export interface PaymentMethodDef {
  key: string
  label: string
}

// Account-wide custom methods, set whenever account settings sync down (see
// settingsStorage.applyRemote). Held at module level rather than threaded
// through every screen as a prop, because a label is needed anywhere a sale
// or refund is shown (lists, receipts, CSV export). Before the first sync it
// is empty and `paymentMethodLabel` falls back to a readable version of the key.
let customMethods: PaymentMethodDef[] = []

/** Replace the account's custom payment methods. Ignores anything that isn't
 * a `{ key, label }` object with non-empty strings. */
export function setCustomPaymentMethods(defs: unknown): void {
  if (!Array.isArray(defs)) {
    customMethods = []
    return
  }
  customMethods = defs.filter(
    (d): d is PaymentMethodDef =>
      typeof d === 'object' &&
      d !== null &&
      typeof (d as PaymentMethodDef).key === 'string' &&
      (d as PaymentMethodDef).key.trim() !== '' &&
      typeof (d as PaymentMethodDef).label === 'string' &&
      (d as PaymentMethodDef).label.trim() !== '',
  )
}

/** "ebay_online_payment" -> "Ebay online payment". */
function humaniseKey(key: string): string {
  const spaced = key.replace(/[_-]+/g, ' ').trim()
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key
}

/** The label to show for any payment method key: the account's own label if
 * the account defines one, else the built-in label, else a readable version
 * of the key. Returns '' for a missing key. */
export function paymentMethodLabel(key: PaymentMethod | null | undefined): string {
  if (!key) return ''
  const custom = customMethods.find((m) => m.key === key)
  if (custom) return custom.label
  if (key in PAYMENT_METHOD_LABELS) return PAYMENT_METHOD_LABELS[key as keyof typeof PAYMENT_METHOD_LABELS]
  return humaniseKey(key)
}

/** The methods to offer in a picker: the built-ins, then the account's custom
 * ones, plus `current` if it's in neither list, so editing an old record
 * never leaves its method with nothing selected. */
export function paymentMethodOptions(current?: PaymentMethod | null): PaymentMethod[] {
  const keys: PaymentMethod[] = [...PAYMENT_METHODS]
  for (const m of customMethods) if (!keys.includes(m.key)) keys.push(m.key)
  if (current && !keys.includes(current)) keys.push(current)
  return keys
}
