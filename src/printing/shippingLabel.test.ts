import { describe, expect, it } from 'vitest'
import { findContentBounds, fitCropToLabel, isFourBySixPage, resolveRotation } from './shippingLabel'

/** A white RGBA image with a black rectangle drawn in it. */
function imageWithBlock(width: number, height: number, block: { x: number; y: number; w: number; h: number }) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  for (let y = block.y; y < block.y + block.h; y++) {
    for (let x = block.x; x < block.x + block.w; x++) {
      const i = (y * width + x) * 4
      data[i] = data[i + 1] = data[i + 2] = 0
    }
  }
  return data
}

describe('findContentBounds', () => {
  it('finds the printed area on an otherwise blank page, with padding', () => {
    const data = imageWithBlock(100, 200, { x: 20, y: 30, w: 40, h: 50 })
    expect(findContentBounds(data, 100, 200, { padding: 2 })).toEqual({ x: 18, y: 28, w: 44, h: 54 })
  })

  it('keeps the padding inside the image', () => {
    const data = imageWithBlock(50, 50, { x: 0, y: 0, w: 10, h: 10 })
    expect(findContentBounds(data, 50, 50, { padding: 5 })).toEqual({ x: 0, y: 0, w: 15, h: 15 })
  })

  it('returns the whole page when it is blank', () => {
    const data = new Uint8ClampedArray(10 * 10 * 4).fill(255)
    expect(findContentBounds(data, 10, 10)).toEqual({ x: 0, y: 0, w: 10, h: 10 })
  })

  it('treats transparent pixels as white', () => {
    const data = new Uint8ClampedArray(10 * 10 * 4) // all transparent black
    expect(findContentBounds(data, 10, 10)).toEqual({ x: 0, y: 0, w: 10, h: 10 })
  })
})

describe('resolveRotation', () => {
  it('turns a landscape label sideways automatically', () => {
    expect(resolveRotation('auto', { x: 0, y: 0, w: 600, h: 400 })).toBe(90)
    expect(resolveRotation('auto', { x: 0, y: 0, w: 400, h: 600 })).toBe(0)
    expect(resolveRotation(180, { x: 0, y: 0, w: 600, h: 400 })).toBe(180)
  })
})

describe('fitCropToLabel', () => {
  it('fills the 4 × 6 label for an exactly 4 × 6 crop', () => {
    const { drawW, drawH } = fitCropToLabel({ x: 0, y: 0, w: 400, h: 600 }, 0)
    expect(Math.round(drawW)).toBe(812)
    expect(Math.round(drawH)).toBe(1218)
  })

  it('fits a rotated landscape crop without stretching', () => {
    const { fit, drawW, drawH } = fitCropToLabel({ x: 0, y: 0, w: 1218, h: 812 }, 90)
    expect(fit).toBeCloseTo(1)
    expect(drawW / drawH).toBeCloseTo(1218 / 812)
  })
})

describe('isFourBySixPage', () => {
  it('recognises a 4 × 6 page either way round, but not A4', () => {
    expect(isFourBySixPage(288, 432)).toBe(true)
    expect(isFourBySixPage(1218, 812)).toBe(true)
    expect(isFourBySixPage(595, 842)).toBe(false)
  })
})
