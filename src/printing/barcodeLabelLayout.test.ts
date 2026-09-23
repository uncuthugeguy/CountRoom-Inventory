import { describe, expect, it } from 'vitest'
import { DEFAULT_BARCODE_LABEL_LAYOUT, LABEL_ELEMENT_KEYS, clampBox, sanitiseBarcodeLabelLayout } from './barcodeLabelLayout'

describe('DEFAULT_BARCODE_LABEL_LAYOUT', () => {
  it('keeps every element on the 406 × 203 dot label', () => {
    for (const key of LABEL_ELEMENT_KEYS) {
      const el = DEFAULT_BARCODE_LABEL_LAYOUT[key]
      expect(el.x).toBeGreaterThanOrEqual(0)
      expect(el.y).toBeGreaterThanOrEqual(0)
      expect(el.x + el.w).toBeLessThanOrEqual(406)
      expect(el.y + el.h).toBeLessThanOrEqual(203)
    }
  })

  it('does not overlap the visible elements', () => {
    const visible = LABEL_ELEMENT_KEYS.filter((k) => DEFAULT_BARCODE_LABEL_LAYOUT[k].visible).map(
      (k) => DEFAULT_BARCODE_LABEL_LAYOUT[k],
    )
    for (let i = 0; i < visible.length; i++) {
      for (let j = i + 1; j < visible.length; j++) {
        const a = visible[i]
        const b = visible[j]
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        expect(overlap).toBe(false)
      }
    }
  })
})

describe('clampBox', () => {
  it('pulls a box back onto the label and enforces a minimum size', () => {
    expect(clampBox({ x: 400, y: -5, w: 50, h: 2 })).toEqual({ x: 356, y: 0, w: 50, h: 10 })
  })
})

describe('sanitiseBarcodeLabelLayout', () => {
  it('falls back to the default for junk or the old Zebra-era template', () => {
    expect(sanitiseBarcodeLabelLayout(undefined)).toEqual(DEFAULT_BARCODE_LABEL_LAYOUT)
    expect(sanitiseBarcodeLabelLayout({ widthDots: 609, heightDots: 305, dpi: 203 })).toEqual(DEFAULT_BARCODE_LABEL_LAYOUT)
  })

  it('fills in missing elements and fixes bad values', () => {
    const result = sanitiseBarcodeLabelLayout({
      version: 2,
      name: { x: 10, y: 10, w: 100, h: 30, visible: true, fontSize: 999, bold: 'yes', align: 'middle' },
    })
    expect(result.name.fontSize).toBe(120)
    expect(result.name.bold).toBe(DEFAULT_BARCODE_LABEL_LAYOUT.name.bold)
    expect(result.name.align).toBe(DEFAULT_BARCODE_LABEL_LAYOUT.name.align)
    expect(result.barcode).toEqual(DEFAULT_BARCODE_LABEL_LAYOUT.barcode)
  })

  it('returns a copy, never the shared default object', () => {
    expect(sanitiseBarcodeLabelLayout(null)).not.toBe(DEFAULT_BARCODE_LABEL_LAYOUT)
  })
})
