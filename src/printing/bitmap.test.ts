import { describe, expect, it } from 'vitest'
import { toMonochromeBitmap } from './bitmap'

/** Builds an RGBA buffer for an image where `dark` marks which pixels are black. */
function rgba(width: number, height: number, dark: boolean[]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const value = dark[i] ? 0 : 255
    data[i * 4] = value
    data[i * 4 + 1] = value
    data[i * 4 + 2] = value
    data[i * 4 + 3] = 255
  }
  return data
}

describe('toMonochromeBitmap', () => {
  it('packs 8 pixels per byte, most significant bit first', () => {
    // 10000001 → the two ends dark, the middle six light.
    const dark = [true, false, false, false, false, false, false, true]
    const image = { width: 8, height: 1, data: rgba(8, 1, dark) }
    expect(toMonochromeBitmap(image).hex).toBe('81')
  })

  it('pads a row up to a whole byte', () => {
    const dark = [true, true, true] // 3 dark pixels in a 3px-wide row
    const image = { width: 3, height: 1, data: rgba(3, 1, dark) }
    const result = toMonochromeBitmap(image)
    expect(result.widthBytes).toBe(1)
    expect(result.hex).toBe('E0') // 11100000
  })

  it('produces one row of bytes per pixel row', () => {
    const image = { width: 8, height: 2, data: rgba(8, 2, [true, ...Array(15).fill(false)]) }
    const result = toMonochromeBitmap(image)
    expect(result.heightDots).toBe(2)
    expect(result.hex).toBe('8000')
  })

  it('treats a fully transparent pixel as light regardless of colour', () => {
    const data = new Uint8ClampedArray(4)
    data[0] = 0
    data[1] = 0
    data[2] = 0
    data[3] = 0 // fully transparent
    const image = { width: 1, height: 1, data }
    expect(toMonochromeBitmap(image).hex).toBe('00')
  })

  it('an all-white image packs to all-zero bytes', () => {
    const image = { width: 8, height: 1, data: rgba(8, 1, Array(8).fill(false)) }
    expect(toMonochromeBitmap(image).hex).toBe('00')
  })
})
