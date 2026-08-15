import { describe, expect, it } from 'vitest'
import { encodeQr } from './qrRender'

describe('encodeQr', () => {
  it('returns null for an empty or blank value', () => {
    expect(encodeQr('')).toBeNull()
    expect(encodeQr('   ')).toBeNull()
  })

  it('encodes a short URL into a square module matrix', () => {
    const matrix = encodeQr('https://example.com/restore')
    expect(matrix).not.toBeNull()
    expect(matrix!.size).toBeGreaterThan(0)
    // Every QR version is square.
    let sawDark = false
    let sawLight = false
    for (let y = 0; y < matrix!.size; y++) {
      for (let x = 0; x < matrix!.size; x++) {
        if (matrix!.isDark(x, y)) sawDark = true
        else sawLight = true
      }
    }
    expect(sawDark).toBe(true)
    expect(sawLight).toBe(true)
  })

  it('produces a larger matrix for longer content', () => {
    const short = encodeQr('A')!
    const long = encodeQr('A'.repeat(500))!
    expect(long.size).toBeGreaterThan(short.size)
  })

  it('draws the same three finder-pattern corners every QR code has', () => {
    // The 7x7 finder squares in the top-left, top-right and bottom-left
    // corners are a fixed, unconditional part of the QR spec — checking
    // their outer ring confirms the matrix isn't just arbitrary noise.
    const matrix = encodeQr('https://example.com')!
    const n = matrix.size
    const checkFinder = (ox: number, oy: number) => {
      for (let i = 0; i < 7; i++) {
        expect(matrix.isDark(ox + i, oy)).toBe(true) // top edge
        expect(matrix.isDark(ox, oy + i)).toBe(true) // left edge
      }
    }
    checkFinder(0, 0)
    checkFinder(n - 7, 0)
    checkFinder(0, n - 7)
  })
})
