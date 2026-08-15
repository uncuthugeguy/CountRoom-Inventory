import { BitArray, Code128Reader } from '@zxing/library'
import { describe, expect, it } from 'vitest'
import { CODE128_QUIET_ZONE_MODULES, encodeCode128 } from './code128Render'

/**
 * Decodes bars back to text using zxing's real `Code128Reader` — the same
 * decoder class the app's camera scanner uses (see `scanner/cameraScanner.ts`).
 * If `encodeCode128`'s bar-width table or checksum math were ever wrong,
 * this is what would catch it: a hand-rolled encoder verified only against
 * itself could be self-consistently wrong forever.
 */
function decodeWithZxing(bars: NonNullable<ReturnType<typeof encodeCode128>>): string {
  const row = new BitArray(CODE128_QUIET_ZONE_MODULES + bars.width + CODE128_QUIET_ZONE_MODULES)
  for (let x = 0; x < bars.width; x++) {
    if (bars.isDark(x)) row.set(CODE128_QUIET_ZONE_MODULES + x)
  }
  return new Code128Reader().decodeRow(0, row).getText()
}

describe('encodeCode128', () => {
  it('returns null for an empty or blank value', () => {
    expect(encodeCode128('')).toBeNull()
    expect(encodeCode128('   ')).toBeNull()
  })

  it('returns null for a character outside Code Set B (ASCII 32–126)', () => {
    expect(encodeCode128('café')).toBeNull()
    expect(encodeCode128('naïve')).toBeNull()
    expect(encodeCode128('emoji 🖨️')).toBeNull()
  })

  it('round-trips every-day quick-code values through zxing\'s own Code 128 decoder', () => {
    const values = [
      'ZEBRA-RESTORE',
      'A',
      '0',
      '0123456789',
      'Guest-WiFi_2.4',
      '~!@#$%^&*()_+={}[]|\\:";\'<>?,./',
      'lowercase and UPPERCASE mixed',
      'X'.repeat(60), // long enough to exercise a two-digit checksum wrap
    ]
    for (const value of values) {
      const bars = encodeCode128(value)
      expect(bars).not.toBeNull()
      expect(decodeWithZxing(bars!)).toBe(value)
    }
  })

  it('produces a wider pattern for longer content', () => {
    const short = encodeCode128('A')!
    const long = encodeCode128('A'.repeat(50))!
    expect(long.width).toBeGreaterThan(short.width)
  })

  it('always starts and ends on a dark (bar) module, per the Code 128 spec', () => {
    const bars = encodeCode128('ZEBRA-RESTORE')!
    expect(bars.isDark(0)).toBe(true)
    expect(bars.isDark(bars.width - 1)).toBe(true)
  })
})
