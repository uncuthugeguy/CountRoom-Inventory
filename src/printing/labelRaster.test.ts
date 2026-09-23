import { describe, expect, it } from 'vitest'
import { labelLeftOnPage, thresholdPixels } from './labelRaster'

describe('labelLeftOnPage', () => {
  it('centres a 2 in label on a 4 in head by default', () => {
    expect(labelLeftOnPage(812, 406, null)).toBe(203)
  })

  it('uses the measured position, kept on the page', () => {
    expect(labelLeftOnPage(812, 406, 150)).toBe(150)
    expect(labelLeftOnPage(812, 406, 700)).toBe(406)
  })

  it('puts a full-width label at the left edge', () => {
    expect(labelLeftOnPage(812, 812, null)).toBe(0)
    expect(labelLeftOnPage(812, 812, 50)).toBe(0)
  })
})

describe('thresholdPixels', () => {
  it('turns every pixel pure black or white, treating transparency as white', () => {
    const data = new Uint8ClampedArray([10, 10, 10, 255, 240, 240, 240, 255, 0, 0, 0, 0])
    thresholdPixels(data)
    expect(Array.from(data)).toEqual([0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255])
  })
})
