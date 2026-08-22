import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildLabelSvg, printLabelViaBrowser } from './browserLabelPrint'
import { DEFAULT_POLONO_LABEL_TEMPLATE } from './labelTemplate'

const PRODUCT = { name: 'Sample Product', sku: 'SKU-001', variation: 'Blue / Large' }

afterEach(() => {
  document.getElementById('stockflow-print-label')?.remove()
  document.getElementById('stockflow-print-label-style')?.remove()
  vi.restoreAllMocks()
})

describe('buildLabelSvg', () => {
  it('sizes the SVG to the template\'s true physical dimensions', () => {
    const svg = buildLabelSvg(PRODUCT, DEFAULT_POLONO_LABEL_TEMPLATE, undefined)
    expect(svg).toContain(`width="${DEFAULT_POLONO_LABEL_TEMPLATE.widthDots / DEFAULT_POLONO_LABEL_TEMPLATE.dpi}in"`)
    expect(svg).toContain(`height="${DEFAULT_POLONO_LABEL_TEMPLATE.heightDots / DEFAULT_POLONO_LABEL_TEMPLATE.dpi}in"`)
    expect(svg).toContain(`viewBox="0 0 ${DEFAULT_POLONO_LABEL_TEMPLATE.widthDots} ${DEFAULT_POLONO_LABEL_TEMPLATE.heightDots}"`)
  })

  it('includes the name and SKU text when those elements are enabled', () => {
    const svg = buildLabelSvg(PRODUCT, DEFAULT_POLONO_LABEL_TEMPLATE, undefined)
    expect(svg).toContain('Sample Product')
    expect(svg).toContain('SKU-001')
  })

  it('draws a real, scannable Code 128 bar pattern for the SKU, not a layout placeholder', () => {
    const svg = buildLabelSvg(PRODUCT, DEFAULT_POLONO_LABEL_TEMPLATE, undefined)
    // A real encode produces a run of <rect> bars; an empty/failed encode wouldn't.
    const barCount = (svg.match(/<rect /g) ?? []).length
    // 1 background rect + at least a handful of bars for a 7-character SKU.
    expect(barCount).toBeGreaterThan(10)
  })

  it('omits the variation and logo by default, matching DEFAULT_POLONO_LABEL_TEMPLATE.include', () => {
    const svg = buildLabelSvg(PRODUCT, DEFAULT_POLONO_LABEL_TEMPLATE, 'data:image/png;base64,AAA')
    expect(svg).not.toContain('Variation:')
    expect(svg).not.toContain('<image')
  })

  it('includes the logo when the template turns it on and a logo is supplied', () => {
    const template = { ...DEFAULT_POLONO_LABEL_TEMPLATE, include: { ...DEFAULT_POLONO_LABEL_TEMPLATE.include, logo: true } }
    const svg = buildLabelSvg(PRODUCT, template, 'data:image/png;base64,AAA')
    expect(svg).toContain('<image')
    expect(svg).toContain('data:image/png;base64,AAA')
  })

  it('skips the logo even when enabled if no logo was uploaded', () => {
    const template = { ...DEFAULT_POLONO_LABEL_TEMPLATE, include: { ...DEFAULT_POLONO_LABEL_TEMPLATE.include, logo: true } }
    const svg = buildLabelSvg(PRODUCT, template, undefined)
    expect(svg).not.toContain('<image')
  })

  it('escapes text so a product name cannot break out of the SVG markup', () => {
    // Wide template so the whole name survives — this test is about
    // escaping, not about `truncateToFitDots` shortening it first; the
    // dedicated truncation test below covers that.
    const wideTemplate = { ...DEFAULT_POLONO_LABEL_TEMPLATE, widthDots: 4000 }
    const svg = buildLabelSvg({ ...PRODUCT, name: '<script>alert(1)</script> & "quoted"' }, wideTemplate, undefined)
    expect(svg).not.toContain('<script>')
    expect(svg).toContain('&lt;script&gt;')
    expect(svg).toContain('&amp;')
    expect(svg).toContain('&quot;quoted&quot;')
  })

  it('shortens a name too long for the label instead of letting it run past the right edge', () => {
    const longName = 'A'.repeat(200)
    const svg = buildLabelSvg({ ...PRODUCT, name: longName }, DEFAULT_POLONO_LABEL_TEMPLATE, undefined)
    expect(svg).not.toContain(longName)
    expect(svg).toContain('…')
  })

  it('drops an element entirely when its `include` flag is off, regardless of content', () => {
    const template = { ...DEFAULT_POLONO_LABEL_TEMPLATE, include: { ...DEFAULT_POLONO_LABEL_TEMPLATE.include, sku: false, barcode: false } }
    const svg = buildLabelSvg(PRODUCT, template, undefined)
    expect(svg).not.toContain('SKU-001')
  })
})

describe('printLabelViaBrowser', () => {
  it('injects a print container sized to the label and calls window.print()', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})

    const result = printLabelViaBrowser(PRODUCT, DEFAULT_POLONO_LABEL_TEMPLATE, undefined)

    expect(result.ok).toBe(true)
    expect(printSpy).toHaveBeenCalledOnce()
    const container = document.getElementById('stockflow-print-label')
    expect(container).not.toBeNull()
    expect(container?.innerHTML).toContain('SKU-001')
    const style = document.getElementById('stockflow-print-label-style')
    expect(style?.textContent).toContain('@page')
    expect(style?.textContent).toContain(`${DEFAULT_POLONO_LABEL_TEMPLATE.widthDots / DEFAULT_POLONO_LABEL_TEMPLATE.dpi}in`)
  })

  it('resets body/html min-height for print, so styles.css\'s min-height: 100vh cannot pad out extra blank pages', () => {
    vi.spyOn(window, 'print').mockImplementation(() => {})

    printLabelViaBrowser(PRODUCT, DEFAULT_POLONO_LABEL_TEMPLATE, undefined)

    // Regression test for a real bug: one real label printed, followed by
    // several blank labels fed and cut — caused by styles.css's unscoped
    // `body { min-height: 100vh }` still applying during print (some
    // browsers resolve vh against the screen viewport, not the tiny label
    // @page size), padding the print job out to extra blank pages.
    const style = document.getElementById('stockflow-print-label-style')
    expect(style?.textContent).toMatch(/min-height:\s*0\s*!important/)
  })

  it('removes the injected container once the print dialog closes', () => {
    vi.spyOn(window, 'print').mockImplementation(() => {})

    printLabelViaBrowser(PRODUCT, DEFAULT_POLONO_LABEL_TEMPLATE, undefined)
    expect(document.getElementById('stockflow-print-label')).not.toBeNull()

    window.dispatchEvent(new Event('afterprint'))

    expect(document.getElementById('stockflow-print-label')).toBeNull()
    expect(document.getElementById('stockflow-print-label-style')).toBeNull()
  })

  it('cleans up any leftover container from an interrupted previous print before starting a new one', () => {
    vi.spyOn(window, 'print').mockImplementation(() => {})

    printLabelViaBrowser(PRODUCT, DEFAULT_POLONO_LABEL_TEMPLATE, undefined)
    // Simulate the tab closing mid-dialog: no `afterprint` fires, so the
    // previous container is still sitting in the DOM.
    printLabelViaBrowser({ ...PRODUCT, sku: 'SKU-002' }, DEFAULT_POLONO_LABEL_TEMPLATE, undefined)

    const containers = document.querySelectorAll('#stockflow-print-label')
    expect(containers).toHaveLength(1)
    expect(containers[0].innerHTML).toContain('SKU-002')
  })

  it('defaults to no rotation: @page keeps the label\'s own width x height, unswapped', () => {
    vi.spyOn(window, 'print').mockImplementation(() => {})

    printLabelViaBrowser(PRODUCT, DEFAULT_POLONO_LABEL_TEMPLATE, undefined)

    // The Chrome-portrait-default issue is real, but a guessed rotation
    // direction previously caused a physical print to come out wrong across
    // multiple labels. Default behaviour must stay exactly as it always
    // was — unrotated — so a user who never touches the new Orientation
    // setting sees no change at all. Rotation is opt-in per printLabel.ts's
    // 4th `rotation` parameter (see the 'cw'/'ccw' tests below).
    const style = document.getElementById('stockflow-print-label-style')
    const widthIn = DEFAULT_POLONO_LABEL_TEMPLATE.widthDots / DEFAULT_POLONO_LABEL_TEMPLATE.dpi
    const heightIn = DEFAULT_POLONO_LABEL_TEMPLATE.heightDots / DEFAULT_POLONO_LABEL_TEMPLATE.dpi
    expect(style?.textContent).toContain(`@page { size: ${widthIn}in ${heightIn}in`)
    expect(style?.textContent).not.toMatch(/transform/)
  })

  it('rotates cw: swaps the @page dimensions and wraps the artwork in an SVG-native transform, not a CSS one', () => {
    vi.spyOn(window, 'print').mockImplementation(() => {})

    printLabelViaBrowser(PRODUCT, DEFAULT_POLONO_LABEL_TEMPLATE, undefined, 'cw')

    // Fix for the Chrome-defaults-to-portrait issue: swap the declared
    // @page size to match what the dialog will default to, and rotate the
    // artwork itself so it still fills the page. This uses the SVG
    // element's own `transform` attribute with explicit dot values rather
    // than a CSS transform — a CSS `translateY(-100%)` on an SVG element
    // does not reliably resolve against the element's own height the way
    // it does on an HTML block, which is what caused the earlier failed
    // attempt (rotated the right amount, wrong direction, and in one
    // real-world test printed across multiple physical labels instead of
    // filling one). Default stays 'off' — this is opt-in and user-tested.
    const style = document.getElementById('stockflow-print-label-style')
    const widthIn = DEFAULT_POLONO_LABEL_TEMPLATE.widthDots / DEFAULT_POLONO_LABEL_TEMPLATE.dpi
    const heightIn = DEFAULT_POLONO_LABEL_TEMPLATE.heightDots / DEFAULT_POLONO_LABEL_TEMPLATE.dpi
    expect(style?.textContent).toContain(`@page { size: ${heightIn}in ${widthIn}in`)
    expect(style?.textContent).not.toMatch(/transform:\s*rotate/)
    const container = document.getElementById('stockflow-print-label')
    expect(container?.innerHTML).toMatch(/transform="translate\([\d.]+,0\) rotate\(90\)"/)
  })

  it('rotates ccw: swaps the @page dimensions the same way but rotates the artwork the other direction', () => {
    vi.spyOn(window, 'print').mockImplementation(() => {})

    printLabelViaBrowser(PRODUCT, DEFAULT_POLONO_LABEL_TEMPLATE, undefined, 'ccw')

    const style = document.getElementById('stockflow-print-label-style')
    const widthIn = DEFAULT_POLONO_LABEL_TEMPLATE.widthDots / DEFAULT_POLONO_LABEL_TEMPLATE.dpi
    const heightIn = DEFAULT_POLONO_LABEL_TEMPLATE.heightDots / DEFAULT_POLONO_LABEL_TEMPLATE.dpi
    expect(style?.textContent).toContain(`@page { size: ${heightIn}in ${widthIn}in`)
    const container = document.getElementById('stockflow-print-label')
    expect(container?.innerHTML).toMatch(/transform="translate\(0,[\d.]+\) rotate\(-90\)"/)
  })

  it('returns a failed result instead of throwing if window.print() itself throws', () => {
    vi.spyOn(window, 'print').mockImplementation(() => {
      throw new Error('print blocked by the OS')
    })

    const result = printLabelViaBrowser(PRODUCT, DEFAULT_POLONO_LABEL_TEMPLATE, undefined)

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe('print blocked by the OS')
    // Cleans up on failure too, rather than leaving a dead container behind.
    expect(document.getElementById('stockflow-print-label')).toBeNull()
  })
})
