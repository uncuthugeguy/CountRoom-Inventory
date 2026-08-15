import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LABEL_TEMPLATE,
  MAX_LOGO_DOTS,
  MIN_LOGO_DOTS,
  sanitiseLabelTemplate,
} from './labelTemplate'

describe('sanitiseLabelTemplate', () => {
  it('clamps the logo position so its whole footprint stays on the label, not just its origin', () => {
    // A logo dragged almost all the way to the bottom-right corner — its
    // origin is technically still "on" the label, but the logo box hanging
    // off it would corrupt the real CPCL print.
    const result = sanitiseLabelTemplate({
      ...DEFAULT_LABEL_TEMPLATE,
      logo: { x: DEFAULT_LABEL_TEMPLATE.widthDots - 10, y: DEFAULT_LABEL_TEMPLATE.heightDots - 10 },
    })
    expect(result.logo.x).toBeLessThanOrEqual(DEFAULT_LABEL_TEMPLATE.widthDots - DEFAULT_LABEL_TEMPLATE.logoWidthDots)
    expect(result.logo.y).toBeLessThanOrEqual(DEFAULT_LABEL_TEMPLATE.heightDots - DEFAULT_LABEL_TEMPLATE.logoHeightDots)
  })

  it('re-clamps a logo position saved on a bigger label after the label is made smaller', () => {
    const result = sanitiseLabelTemplate({
      ...DEFAULT_LABEL_TEMPLATE,
      widthDots: 300,
      heightDots: 150,
      logo: { x: 250, y: 120 }, // valid on a much bigger label, not this one
    })
    expect(result.logo.x).toBeLessThanOrEqual(300 - DEFAULT_LABEL_TEMPLATE.logoWidthDots)
    expect(result.logo.y).toBeLessThanOrEqual(150 - DEFAULT_LABEL_TEMPLATE.logoHeightDots)
  })

  it('leaves an on-label logo position untouched', () => {
    const result = sanitiseLabelTemplate({ ...DEFAULT_LABEL_TEMPLATE, logo: { x: 20, y: 20 } })
    expect(result.logo).toEqual({ x: 20, y: 20 })
  })

  it('falls back to a usable bound when the label is smaller than the logo itself', () => {
    // A 100x100 label is smaller than the default 120x60 logo footprint on
    // the X axis — the clamp still returns 0 rather than a negative bound,
    // even though the logo will unavoidably overhang a label this small.
    const result = sanitiseLabelTemplate({ ...DEFAULT_LABEL_TEMPLATE, widthDots: 100, heightDots: 100, logo: { x: 50, y: 50 } })
    expect(result.logo.x).toBe(0)
    expect(result.logo.y).toBe(100 - DEFAULT_LABEL_TEMPLATE.logoHeightDots) // height alone does fit
  })

  it('resizes the logo box, clamped to a sane range', () => {
    const shrunk = sanitiseLabelTemplate({ ...DEFAULT_LABEL_TEMPLATE, logoWidthDots: 5, logoHeightDots: 5 })
    expect(shrunk.logoWidthDots).toBe(MIN_LOGO_DOTS)
    expect(shrunk.logoHeightDots).toBe(MIN_LOGO_DOTS)

    const grown = sanitiseLabelTemplate({ ...DEFAULT_LABEL_TEMPLATE, logoWidthDots: 999999, logoHeightDots: 999999 })
    expect(grown.logoWidthDots).toBe(MAX_LOGO_DOTS)
    expect(grown.logoHeightDots).toBe(MAX_LOGO_DOTS)
  })

  it('fills in a missing logo size from an older saved template', () => {
    const { logoWidthDots: _w, logoHeightDots: _h, ...withoutLogoSize } = DEFAULT_LABEL_TEMPLATE
    const result = sanitiseLabelTemplate(withoutLogoSize as typeof DEFAULT_LABEL_TEMPLATE)
    expect(result.logoWidthDots).toBe(DEFAULT_LABEL_TEMPLATE.logoWidthDots)
    expect(result.logoHeightDots).toBe(DEFAULT_LABEL_TEMPLATE.logoHeightDots)
  })

  it('fills in a missing barcodeModuleWidth from an older saved template', () => {
    const { barcodeModuleWidth: _drop, ...withoutModuleWidth } = DEFAULT_LABEL_TEMPLATE
    const result = sanitiseLabelTemplate(withoutModuleWidth as typeof DEFAULT_LABEL_TEMPLATE)
    expect(result.barcodeModuleWidth).toBe(DEFAULT_LABEL_TEMPLATE.barcodeModuleWidth)
  })

  it('clamps barcodeModuleWidth to a sane range', () => {
    expect(sanitiseLabelTemplate({ ...DEFAULT_LABEL_TEMPLATE, barcodeModuleWidth: 0 }).barcodeModuleWidth).toBe(1)
    expect(sanitiseLabelTemplate({ ...DEFAULT_LABEL_TEMPLATE, barcodeModuleWidth: 999 }).barcodeModuleWidth).toBe(10)
  })

  it('clamps the barcode position for its height and an estimate of its width', () => {
    const nearEdge = { x: DEFAULT_LABEL_TEMPLATE.widthDots - 10, y: DEFAULT_LABEL_TEMPLATE.heightDots - 10 }
    const result = sanitiseLabelTemplate({
      ...DEFAULT_LABEL_TEMPLATE,
      barcode: nearEdge,
      barcodeHeight: 60,
      barcodeModuleWidth: 2,
    })
    expect(result.barcode.y).toBeLessThanOrEqual(DEFAULT_LABEL_TEMPLATE.heightDots - 60)
    expect(result.barcode.x).toBeLessThan(nearEdge.x)
  })

  it('clamps darkness and print speed to Zebra\'s documented SGD ranges', () => {
    expect(sanitiseLabelTemplate({ ...DEFAULT_LABEL_TEMPLATE, darkness: -5 }).darkness).toBe(0)
    expect(sanitiseLabelTemplate({ ...DEFAULT_LABEL_TEMPLATE, darkness: 999 }).darkness).toBe(30)
    expect(sanitiseLabelTemplate({ ...DEFAULT_LABEL_TEMPLATE, printSpeedIps: 0 }).printSpeedIps).toBe(2)
    expect(sanitiseLabelTemplate({ ...DEFAULT_LABEL_TEMPLATE, printSpeedIps: 999 }).printSpeedIps).toBe(12)
  })

  it('fills in darkness/print speed from an older saved template that predates them', () => {
    const { darkness: _d, printSpeedIps: _s, ...withoutPrintSettings } = DEFAULT_LABEL_TEMPLATE
    const result = sanitiseLabelTemplate(withoutPrintSettings as typeof DEFAULT_LABEL_TEMPLATE)
    expect(result.darkness).toBe(DEFAULT_LABEL_TEMPLATE.darkness)
    expect(result.printSpeedIps).toBe(DEFAULT_LABEL_TEMPLATE.printSpeedIps)
  })

  it('defaults every element to visible on a template saved before per-element visibility existed', () => {
    const { include: _i, ...withoutInclude } = DEFAULT_LABEL_TEMPLATE
    const result = sanitiseLabelTemplate(withoutInclude as typeof DEFAULT_LABEL_TEMPLATE)
    expect(result.include).toEqual({ name: true, variation: true, barcode: true, sku: true, logo: true })
  })

  it('keeps an explicitly hidden element hidden, and defaults any other missing key to visible', () => {
    const result = sanitiseLabelTemplate({ ...DEFAULT_LABEL_TEMPLATE, include: { logo: false } as never })
    expect(result.include).toEqual({ name: true, variation: true, barcode: true, sku: true, logo: false })
  })
})
