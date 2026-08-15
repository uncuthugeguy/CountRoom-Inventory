import { describe, expect, it } from 'vitest'
import { matchesQuickCodeSearch, sanitiseQuickCodes, type QuickCode } from './quickCodes'

const code = (overrides: Partial<QuickCode> = {}): QuickCode => ({
  id: '1',
  category: 'Printer codes',
  name: 'Restore defaults',
  value: 'ZEBRA-RESTORE',
  format: 'qr',
  ...overrides,
})

describe('sanitiseQuickCodes', () => {
  it('keeps a well-formed code as-is', () => {
    expect(sanitiseQuickCodes([code()])).toEqual([code()])
  })

  it('drops anything that is not an object', () => {
    expect(sanitiseQuickCodes([null, 'string', 42, undefined])).toEqual([])
  })

  it('drops an entry missing id, name or value', () => {
    expect(sanitiseQuickCodes([{ id: '1', name: 'X' }, { name: 'X', value: 'V' }])).toEqual([])
  })

  it('falls back to category "Other" when missing or blank', () => {
    const [a] = sanitiseQuickCodes([code({ category: '' })])
    const [b] = sanitiseQuickCodes([{ id: '1', name: 'X', value: 'V' }])
    expect(a.category).toBe('Other')
    expect(b.category).toBe('Other')
  })

  it('falls back to format "qr" for anything but "code128"', () => {
    expect(sanitiseQuickCodes([code({ format: 'qr' })])[0].format).toBe('qr')
    expect(sanitiseQuickCodes([code({ format: 'code128' })])[0].format).toBe('code128')
    expect(sanitiseQuickCodes([{ ...code(), format: 'nonsense' }])[0].format).toBe('qr')
  })

  it('drops a blank note but keeps a real one', () => {
    expect(sanitiseQuickCodes([code({ note: '' })])[0].note).toBeUndefined()
    expect(sanitiseQuickCodes([code({ note: 'Hold 3s' })])[0].note).toBe('Hold 3s')
  })

  it('returns an empty array for anything that is not an array', () => {
    expect(sanitiseQuickCodes(undefined)).toEqual([])
    expect(sanitiseQuickCodes({})).toEqual([])
  })
})

describe('matchesQuickCodeSearch', () => {
  const c = code({ name: 'Restore defaults', category: 'Printer codes', note: 'Hold for 3s', value: 'ZEBRA-RESTORE-XYZ' })

  it('matches a blank query unconditionally', () => {
    expect(matchesQuickCodeSearch(c, '')).toBe(true)
    expect(matchesQuickCodeSearch(c, '   ')).toBe(true)
  })

  it('matches by name, case-insensitively', () => {
    expect(matchesQuickCodeSearch(c, 'restore')).toBe(true)
    expect(matchesQuickCodeSearch(c, 'RESTORE')).toBe(true)
  })

  it('matches by category', () => {
    expect(matchesQuickCodeSearch(c, 'printer')).toBe(true)
  })

  it('matches by note', () => {
    expect(matchesQuickCodeSearch(c, 'hold for')).toBe(true)
  })

  it('matches by the raw value', () => {
    expect(matchesQuickCodeSearch(c, 'xyz')).toBe(true)
  })

  it('does not match unrelated text', () => {
    expect(matchesQuickCodeSearch(c, 'wifi')).toBe(false)
  })
})
