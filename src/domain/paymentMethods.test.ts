import { afterEach, describe, expect, it } from 'vitest'
import { paymentMethodLabel, paymentMethodOptions, setCustomPaymentMethods } from './paymentMethods'

afterEach(() => setCustomPaymentMethods([]))

describe('paymentMethodLabel', () => {
  it('labels the built-ins', () => {
    expect(paymentMethodLabel('cash')).toBe('Cash')
    expect(paymentMethodLabel('other')).toBe('Other')
  })

  it("uses the account's own label for a custom method", () => {
    setCustomPaymentMethods([{ key: 'ebay_online_payment', label: 'Ebay Online Payment' }])
    expect(paymentMethodLabel('ebay_online_payment')).toBe('Ebay Online Payment')
  })

  it('falls back to a readable key before settings have synced', () => {
    expect(paymentMethodLabel('gift_voucher')).toBe('Gift voucher')
  })

  it('returns an empty string for no method', () => {
    expect(paymentMethodLabel(null)).toBe('')
    expect(paymentMethodLabel(undefined)).toBe('')
  })

  it('ignores malformed entries', () => {
    setCustomPaymentMethods([{ key: '', label: 'x' }, { key: 'k' }, null, 'nope'])
    expect(paymentMethodLabel('k')).toBe('K')
  })
})

describe('paymentMethodOptions', () => {
  it('lists built-ins, then custom methods, then an unknown current method', () => {
    setCustomPaymentMethods([
      { key: 'card', label: 'Card' },
      { key: 'ebay_online_payment', label: 'Ebay Online Payment' },
    ])
    expect(paymentMethodOptions('legacy_voucher')).toEqual([
      'cash',
      'card',
      'other',
      'ebay_online_payment',
      'legacy_voucher',
    ])
  })
})
