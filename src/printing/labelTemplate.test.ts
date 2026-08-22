import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LABEL_TEMPLATE,
  DEFAULT_POLONO_FONT_FAMILY,
  DEFAULT_POLONO_LABEL_TEMPLATE,
  MAX_CUSTOM_FONT_DOTS,
  MAX_LOGO_DOTS,
  MIN_CUSTOM_FONT_DOTS,
  MIN_LOGO_DOTS,
  POLONO_FONT_CHOICES,
  approxTextWidthDots,
  sanitiseLabelTemplate,
  sanitisePolonoPrintRotation,
  textFamilyFor,
  textHeightDots,
  textSizeDotsFor,
  truncateToFitDots,
} from './labelTemplate'

describe('truncateToFitDots', () => {
  it('returns the text unchanged when it already fits', () => {
    expect(truncateToFitDots('Widget', 1000, 38)).toBe('Widget')
  })

  it('shortens text that is too wide, ending with an ellipsis', () => {
    const result = truncateToFitDots('A very long product name indeed', 100, 38)
    expect(result.length).toBeLessThan('A very long product name indeed'.length)
    expect(result.endsWith('…')).toBe(true)
    expect(approxTextWidthDots(result, 38)).toBeLessThanOrEqual(100)
  })

  it('returns an empty string when there is no room at all', () => {
    expect(truncateToFitDots('Widget', 0, 38)).toBe('')
    expect(truncateToFitDots('Widget', -5, 38)).toBe('')
  })

  it('falls back to just the ellipsis when even one character does not fit', () => {
    expect(truncateToFitDots('Widget', 1, 38)).toBe('…')
  })
})

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

  it('clamps a custom Polono font size to the sane range and drops it if not a finite number', () => {
    expect(sanitiseLabelTemplate({ ...DEFAULT_LABEL_TEMPLATE, nameFontSizeDots: 2 }).nameFontSizeDots).toBe(
      MIN_CUSTOM_FONT_DOTS,
    )
    expect(sanitiseLabelTemplate({ ...DEFAULT_LABEL_TEMPLATE, nameFontSizeDots: 99999 }).nameFontSizeDots).toBe(
      MAX_CUSTOM_FONT_DOTS,
    )
    expect(
      sanitiseLabelTemplate({ ...DEFAULT_LABEL_TEMPLATE, nameFontSizeDots: Number.NaN }).nameFontSizeDots,
    ).toBeUndefined()
    expect(sanitiseLabelTemplate(DEFAULT_LABEL_TEMPLATE).nameFontSizeDots).toBeUndefined()
  })

  it('keeps a valid Polono font family, and falls back to undefined (not a stray value) for anything else', () => {
    const family = POLONO_FONT_CHOICES[2].family
    expect(sanitiseLabelTemplate({ ...DEFAULT_LABEL_TEMPLATE, nameFontFamily: family }).nameFontFamily).toBe(family)
    expect(
      sanitiseLabelTemplate({ ...DEFAULT_LABEL_TEMPLATE, nameFontFamily: 'Comic Sans MS' }).nameFontFamily,
    ).toBeUndefined()
    expect(sanitiseLabelTemplate(DEFAULT_LABEL_TEMPLATE).nameFontFamily).toBeUndefined()
  })

  it('widens the vertical clamp for a text element when its custom Polono size is taller than the stepped font it replaces', () => {
    // A huge custom name size on a short label must not leave a saved y
    // position that would run the larger real text off the bottom, even
    // though the stepped `nameFont` index itself is still small.
    const result = sanitiseLabelTemplate({
      ...DEFAULT_LABEL_TEMPLATE,
      heightDots: 200,
      nameFont: 0, // stepped height would only be 14 dots
      nameFontSizeDots: 150, // but the Polono override is much taller
      name: { x: 10, y: 190 },
    })
    expect(result.name.y).toBeLessThanOrEqual(200 - 150)
  })
})

describe('textSizeDotsFor', () => {
  it('uses the stepped CPCL font height for the Zebra, ignoring any custom Polono size', () => {
    const template = { ...DEFAULT_LABEL_TEMPLATE, nameFontSizeDots: 200 }
    expect(textSizeDotsFor(template, 'name', false)).toBe(textHeightDots(template.nameFont))
  })

  it('prefers the custom Polono size when set', () => {
    const template = { ...DEFAULT_LABEL_TEMPLATE, nameFontSizeDots: 42 }
    expect(textSizeDotsFor(template, 'name', true)).toBe(42)
  })

  it('falls back to the stepped CPCL font height on the Polono when no custom size is set', () => {
    expect(textSizeDotsFor(DEFAULT_LABEL_TEMPLATE, 'sku', true)).toBe(textHeightDots(DEFAULT_LABEL_TEMPLATE.skuFont))
  })
})

describe('textFamilyFor', () => {
  it('always returns the fixed monospace stack for the Zebra, even if a Polono family was saved', () => {
    const template = { ...DEFAULT_LABEL_TEMPLATE, nameFontFamily: POLONO_FONT_CHOICES[1].family }
    expect(textFamilyFor(template, 'name', false)).toBe('ui-monospace, monospace')
  })

  it('returns the saved Polono family when set', () => {
    const template = { ...DEFAULT_LABEL_TEMPLATE, skuFontFamily: POLONO_FONT_CHOICES[3].family }
    expect(textFamilyFor(template, 'sku', true)).toBe(POLONO_FONT_CHOICES[3].family)
  })

  it('falls back to the default Polono family when none is set', () => {
    expect(textFamilyFor(DEFAULT_LABEL_TEMPLATE, 'variation', true)).toBe(DEFAULT_POLONO_FONT_FAMILY)
  })
})

describe('DEFAULT_POLONO_LABEL_TEMPLATE actually fills the label', () => {
  // Regression guard for a real, repeated failure mode: earlier default
  // layouts looked correct on paper (positions/sizes computed to leave only
  // a small margin) but real physical prints kept showing large unused
  // space — each round of "the label isn't full" turned out to need a
  // bigger fix than the last, because nothing ever asserted the *fraction*
  // of the label actually covered, only that individual fields were in
  // range. This pins that fraction down directly so a future default that
  // regresses back to a small, timid layout fails a test instead of only
  // showing up in a customer's photo.
  const t = DEFAULT_POLONO_LABEL_TEMPLATE

  it('covers at least 90% of the label height (name + barcode + SKU, top to bottom)', () => {
    const nameBottom = t.name.y + textSizeDotsFor(t, 'name', true)
    const skuBottom = t.sku.y + textSizeDotsFor(t, 'sku', true)
    const barcodeBottom = t.barcode.y + t.barcodeHeight
    const bottomMost = Math.max(nameBottom, skuBottom, barcodeBottom)
    expect(bottomMost / t.heightDots).toBeGreaterThanOrEqual(0.9)
  })

  it('starts within a few dots of the top edge, not sitting in the middle of the label', () => {
    expect(Math.min(t.name.y, t.barcode.y)).toBeLessThanOrEqual(10)
  })
})

describe('sanitisePolonoPrintRotation', () => {
  it('accepts "cw" and "ccw"', () => {
    expect(sanitisePolonoPrintRotation('cw')).toBe('cw')
    expect(sanitisePolonoPrintRotation('ccw')).toBe('ccw')
  })

  it('falls back to "off" for anything else, including undefined/garbage values', () => {
    expect(sanitisePolonoPrintRotation('off')).toBe('off')
    expect(sanitisePolonoPrintRotation(undefined)).toBe('off')
    expect(sanitisePolonoPrintRotation('sideways')).toBe('off')
    expect(sanitisePolonoPrintRotation(42)).toBe('off')
  })
})
