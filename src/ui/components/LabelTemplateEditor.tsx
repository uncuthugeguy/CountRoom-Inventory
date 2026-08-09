import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { Product } from '../../domain/types'
import {
  DEFAULT_LABEL_TEMPLATE,
  MAX_FONT,
  MAX_LOGO_DOTS,
  MIN_FONT,
  MIN_LOGO_DOTS,
  approxTextWidthDots,
  estimateBarcodeWidthDots,
  sanitiseLabelTemplate,
  textHeightDots,
  type ElementPosition,
  type LabelTemplate,
} from '../../printing/labelTemplate'
import { printProductLabel } from '../../printing/printLabel'
import type { SettingsApi } from '../useSettings'

export interface LabelTemplateEditorProps {
  settings: SettingsApi
}

/** A stand-in product used only for the "print test label" button and the live preview. */
const SAMPLE_PRODUCT: Product = {
  id: 'sample',
  barcode: '',
  sku: 'SKU-0001',
  name: 'Sample Product Name',
  category: '',
  location: '',
  variation: 'Blue / Large',
  quantity: 1,
  reorderLevel: 0,
  cost: 0,
  price: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const FIELD_LIMITS = {
  widthDots: { min: 100, max: 4000 },
  heightDots: { min: 100, max: 4000 },
  dpi: { min: 100, max: 600 },
  barcodeHeight: { min: 10, max: 1000 },
  barcodeModuleWidth: { min: 1, max: 10 },
  logoWidthDots: { min: MIN_LOGO_DOTS, max: MAX_LOGO_DOTS },
  logoHeightDots: { min: MIN_LOGO_DOTS, max: MAX_LOGO_DOTS },
} as const

const PREVIEW_MAX_WIDTH = 420

/** Every physical field is stored in dots (what CPCL speaks) but can be
 * viewed and edited in inches or millimetres — converted using the
 * template's own DPI, since dots only mean a physical size at a given
 * resolution. */
type Unit = 'dots' | 'in' | 'mm'

const UNIT_OPTIONS: { value: Unit; label: string }[] = [
  { value: 'dots', label: 'Dots' },
  { value: 'in', label: 'Inches' },
  { value: 'mm', label: 'Millimetres' },
]

const UNIT_SUFFIX: Record<Unit, string> = { dots: 'dots', in: 'in', mm: 'mm' }
const UNIT_STEP: Record<Unit, number> = { dots: 1, in: 0.01, mm: 0.5 }
const MM_PER_INCH = 25.4

const dotsToUnit = (dots: number, unit: Unit, dpi: number): number => {
  if (unit === 'dots') return dots
  const inches = dots / dpi
  return unit === 'in' ? inches : inches * MM_PER_INCH
}

const unitToDots = (value: number, unit: Unit, dpi: number): number => {
  if (unit === 'dots') return value
  const inches = unit === 'in' ? value : value / MM_PER_INCH
  return inches * dpi
}

/** Rounds for display only — full precision is kept in the stored dots value. */
const roundForUnit = (value: number, unit: Unit): number => {
  const decimals = unit === 'dots' ? 0 : unit === 'in' ? 3 : 1
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

const clampNum = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

const commitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
  if (event.key === 'Enter') event.currentTarget.blur()
}

interface DimensionFieldProps {
  id: string
  label: string
  dotsValue: number
  dpi: number
  unit: Unit
  min: number
  max: number
  isDimension: boolean
  hint?: string
  onCommit: (dots: number) => void
}

/**
 * A numeric field for label size, DPI and barcode height.
 *
 * Two things make the native `<input type="number">` painful for millimetre
 * values: its spin arrows are tiny and step by a fixed amount, so nudging a
 * width from 100mm to 50mm means dozens of taps that feel like "just
 * scrolling up and down"; and fully re-deriving + clamping the display value
 * on every keystroke fights you mid-edit — clearing the field to type a new
 * number snaps straight back to the min/max before you've finished typing.
 *
 * This keeps its own text buffer while the field has typing in flight (never
 * rewritten out from under the user), only parses/clamps/converts on blur or
 * Enter, and swaps the native spinner for two large +/- buttons that step by
 * one whole display unit per press.
 */
function DimensionField({
  id,
  label,
  dotsValue,
  dpi,
  unit,
  min,
  max,
  isDimension,
  hint,
  onCommit,
}: DimensionFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const displayValue = isDimension ? roundForUnit(dotsToUnit(dotsValue, unit, dpi), unit) : dotsValue
  const displayMin = isDimension ? dotsToUnit(min, unit, dpi) : min
  const displayMax = isDimension ? dotsToUnit(max, unit, dpi) : max
  const step = isDimension ? UNIT_STEP[unit] : 1

  const [text, setText] = useState(() => String(displayValue))

  // Resync from the outside — a unit switch, "reset to defaults", or the DPI
  // field changing what a dot is worth — but only while this field isn't the
  // one being typed into, so we never overwrite an in-progress edit.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setText(String(displayValue))
    }
  }, [displayValue])

  const commit = (nextDisplay: number) => {
    const clamped = clampNum(nextDisplay, displayMin, displayMax)
    const dots = isDimension ? Math.round(unitToDots(clamped, unit, dpi)) : Math.round(clamped)
    onCommit(dots)
    setText(String(isDimension ? roundForUnit(clamped, unit) : Math.round(clamped)))
  }

  const commitTypedText = () => {
    const parsed = Number(text)
    if (text.trim() === '' || Number.isNaN(parsed)) {
      setText(String(displayValue)) // nothing usable typed yet — revert rather than clamp mid-edit
      return
    }
    commit(parsed)
  }

  const nudge = (direction: 1 | -1) => {
    const base = Number(text)
    const current = Number.isNaN(base) ? displayValue : base
    commit(current + direction * step)
  }

  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {isDimension ? ` (${UNIT_SUFFIX[unit]})` : ''}
      </label>
      <div className="number-stepper">
        <button type="button" className="button" aria-label={`Decrease ${label}`} onClick={() => nudge(-1)}>
          −
        </button>
        <input
          ref={inputRef}
          id={id}
          type="text"
          inputMode="decimal"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={commitTypedText}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commitTypedText()
              inputRef.current?.blur()
            }
          }}
        />
        <button type="button" className="button" aria-label={`Increase ${label}`} onClick={() => nudge(1)}>
          +
        </button>
      </div>
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}

type ElementKey = 'logo' | 'name' | 'variation' | 'barcode' | 'sku'

const ELEMENT_LABEL: Record<ElementKey, string> = {
  logo: 'Logo',
  name: 'Name',
  variation: 'Variation',
  barcode: 'Barcode',
  sku: 'SKU text',
}

/** The three text elements resize by changing their CPCL font index — the
 * printer's built-in bitmap fonts only come in 8 fixed sizes (0–7), so
 * dragging a resize handle steps through those 8 sizes rather than resizing
 * continuously. The barcode and logo are the two elements with independent,
 * freely variable dimensions: the barcode's bar height and — via CPCL's
 * module-width parameter — its overall printed width; the logo's box width
 * and height, scaled to fit within (see `rasterizeLogo`). */
type TextElementKey = 'name' | 'variation' | 'sku'

const FONT_FIELD: Record<TextElementKey, 'nameFont' | 'variationFont' | 'skuFont'> = {
  name: 'nameFont',
  variation: 'variationFont',
  sku: 'skuFont',
}

type ResizableKey = TextElementKey | 'barcode' | 'logo'

/** Every resizable element gets a handle at each of its four corners, not
 * just the bottom-right one — if the element has been dragged off the edge
 * of the label, the corner still on-screen is the only one you can grab. */
type Corner = 'nw' | 'ne' | 'sw' | 'se'
const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se']
/** Which direction along each axis counts as "growing" for a given corner —
 * dragging any corner outward (away from the box's centre) grows it, and
 * dragging it inward shrinks it, regardless of which corner is grabbed. */
const CORNER_SIGN: Record<Corner, { x: 1 | -1; y: 1 | -1 }> = {
  se: { x: 1, y: 1 },
  sw: { x: -1, y: 1 },
  ne: { x: 1, y: -1 },
  nw: { x: -1, y: -1 },
}

interface DragState {
  key: ElementKey
  /** Pointer position, in dots, minus the element's position at drag start —
   * kept constant through the drag so the element moves with the pointer
   * instead of snapping its top-left corner under it. */
  offsetX: number
  offsetY: number
}

interface ResizeState {
  key: ResizableKey
  corner: Corner
  /** Pointer position, in dots, at drag start. */
  startDotsX: number
  startDotsY: number
  /** Font index (0–7) at drag start — only meaningful for text elements. */
  startFont: number
  /** Barcode bar height and module width, in dots, at drag start — only meaningful for the barcode. */
  startBarcodeHeight: number
  startBarcodeModuleWidth: number
  /** Logo box width and height, in dots, at drag start — only meaningful for the logo. */
  startLogoWidth: number
  startLogoHeight: number
}

interface ResizeLiveValue {
  key: ResizableKey
  font: number
  barcodeHeight: number
  barcodeModuleWidth: number
  logoWidth: number
  logoHeight: number
}

interface Footprint {
  width: number
  height: number
}

function LabelCanvas({
  template,
  logoDataUrl,
  onMove,
  onFontResize,
  onBarcodeResize,
  onLogoResize,
}: {
  template: LabelTemplate
  logoDataUrl?: string
  onMove: (key: ElementKey, position: ElementPosition) => void
  onFontResize: (key: TextElementKey, font: number) => void
  onBarcodeResize: (next: { heightDots: number; moduleWidth: number }) => void
  onLogoResize: (next: { widthDots: number; heightDots: number }) => void
}) {
  const t = template
  const svgRef = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  // The dragged element's position while the drag is in flight — kept out of
  // the saved template (and out of localStorage) until pointerup, so a drag
  // doesn't write to storage on every pixel of movement.
  const [livePosition, setLivePosition] = useState<{ key: ElementKey; position: ElementPosition } | null>(null)

  const [resize, setResize] = useState<ResizeState | null>(null)
  // Same idea as livePosition, but for the value(s) a resize handle is changing.
  const [liveResizeValue, setLiveResizeValue] = useState<ResizeLiveValue | null>(null)

  const scale = Math.min(1, PREVIEW_MAX_WIDTH / t.widthDots)
  const px = (dots: number) => dots * scale

  const positionOf = (key: ElementKey): ElementPosition =>
    livePosition && livePosition.key === key ? livePosition.position : t[key]

  const fontOf = (key: TextElementKey): number =>
    liveResizeValue && liveResizeValue.key === key ? liveResizeValue.font : t[FONT_FIELD[key]]

  const barcodeHeightOf = (): number =>
    liveResizeValue && liveResizeValue.key === 'barcode' ? liveResizeValue.barcodeHeight : t.barcodeHeight

  const barcodeModuleWidthOf = (): number =>
    liveResizeValue && liveResizeValue.key === 'barcode' ? liveResizeValue.barcodeModuleWidth : t.barcodeModuleWidth

  const logoWidthOf = (): number =>
    liveResizeValue && liveResizeValue.key === 'logo' ? liveResizeValue.logoWidth : t.logoWidthDots

  const logoHeightOf = (): number =>
    liveResizeValue && liveResizeValue.key === 'logo' ? liveResizeValue.logoHeight : t.logoHeightDots

  // Every element's on-screen size, right now (including live drag/resize
  // values) — the single source of truth for both what's drawn and how far
  // a drag or nudge is allowed to go, so an element can never be pushed
  // somewhere its own bulk would hang off the label.
  const nameSize = textHeightDots(fontOf('name'))
  const variationSize = textHeightDots(fontOf('variation'))
  const skuSize = textHeightDots(fontOf('sku'))
  const barcodeHeight = barcodeHeightOf()
  const barcodeModuleWidth = barcodeModuleWidthOf()
  const logoWidth = logoWidthOf()
  const logoHeight = logoHeightOf()

  const nameWidth = approxTextWidthDots(SAMPLE_PRODUCT.name, nameSize)
  const variationWidth = approxTextWidthDots(`Variation: ${SAMPLE_PRODUCT.variation}`, variationSize)
  const skuWidth = approxTextWidthDots(SAMPLE_PRODUCT.sku, skuSize)
  const barcodeWidth = estimateBarcodeWidthDots(barcodeModuleWidth)

  const footprintOf = (key: ElementKey): Footprint => {
    switch (key) {
      case 'logo':
        return { width: logoWidth, height: logoHeight }
      case 'name':
        return { width: nameWidth, height: nameSize }
      case 'variation':
        return { width: variationWidth, height: variationSize }
      case 'barcode':
        return { width: barcodeWidth, height: barcodeHeight }
      case 'sku':
        return { width: skuWidth, height: skuSize }
    }
  }

  const clientToDots = (clientX: number, clientY: number): ElementPosition => {
    const rect = svgRef.current!.getBoundingClientRect()
    return {
      x: ((clientX - rect.left) / rect.width) * t.widthDots,
      y: ((clientY - rect.top) / rect.height) * t.heightDots,
    }
  }

  /** Clamps a position so the element's whole footprint — not just its
   * origin corner — stays on the label. Dragging (or nudging) an element
   * mostly off the label used to be possible because only the origin point
   * was kept in bounds; the browser's SVG preview clips the overhang so it
   * looked roughly fine on screen, but the real printer doesn't clip its
   * TEXT/BARCODE/EG commands, so the overrun corrupted the physical print. */
  const clampToLabel = (position: ElementPosition, footprint: Footprint): ElementPosition => ({
    x: Math.round(clampNum(position.x, 0, Math.max(0, t.widthDots - footprint.width))),
    y: Math.round(clampNum(position.y, 0, Math.max(0, t.heightDots - footprint.height))),
  })

  const startDrag = (key: ElementKey) => (event: React.PointerEvent) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const pointerDots = clientToDots(event.clientX, event.clientY)
    const current = t[key]
    setDrag({ key, offsetX: pointerDots.x - current.x, offsetY: pointerDots.y - current.y })
    setLivePosition({ key, position: current })
  }

  const startResize = (key: ResizableKey, corner: Corner) => (event: React.PointerEvent) => {
    event.preventDefault()
    event.stopPropagation() // don't also start a move-drag on the parent box
    event.currentTarget.setPointerCapture(event.pointerId)
    const pointerDots = clientToDots(event.clientX, event.clientY)
    const startFont = key === 'barcode' || key === 'logo' ? 0 : t[FONT_FIELD[key]]
    setResize({
      key,
      corner,
      startDotsX: pointerDots.x,
      startDotsY: pointerDots.y,
      startFont,
      startBarcodeHeight: t.barcodeHeight,
      startBarcodeModuleWidth: t.barcodeModuleWidth,
      startLogoWidth: t.logoWidthDots,
      startLogoHeight: t.logoHeightDots,
    })
    setLiveResizeValue({
      key,
      font: startFont,
      barcodeHeight: t.barcodeHeight,
      barcodeModuleWidth: t.barcodeModuleWidth,
      logoWidth: t.logoWidthDots,
      logoHeight: t.logoHeightDots,
    })
  }

  const onPointerMove = (event: React.PointerEvent) => {
    if (drag) {
      const pointerDots = clientToDots(event.clientX, event.clientY)
      const next = clampToLabel(
        { x: pointerDots.x - drag.offsetX, y: pointerDots.y - drag.offsetY },
        footprintOf(drag.key),
      )
      setLivePosition({ key: drag.key, position: next })
      return
    }
    if (resize) {
      const pointerDots = clientToDots(event.clientX, event.clientY)
      const sign = CORNER_SIGN[resize.corner]
      const deltaX = (pointerDots.x - resize.startDotsX) * sign.x
      const deltaY = (pointerDots.y - resize.startDotsY) * sign.y
      if (resize.key === 'barcode') {
        const nextHeight = Math.round(clampNum(resize.startBarcodeHeight + deltaY, 10, 1000))
        // 20 dots of drag per module-width step keeps the drag feeling
        // proportional — the module width only ranges 1–10 dots, a much
        // smaller range than the pixel distance a hand naturally drags.
        const nextModuleWidth = Math.round(clampNum(resize.startBarcodeModuleWidth + deltaX / 20, 1, 10))
        setLiveResizeValue({
          key: 'barcode',
          font: 0,
          barcodeHeight: nextHeight,
          barcodeModuleWidth: nextModuleWidth,
          logoWidth: 0,
          logoHeight: 0,
        })
      } else if (resize.key === 'logo') {
        // Unlike the barcode's tiny 1–10 module-width range, the logo box
        // spans up to MAX_LOGO_DOTS, so a direct 1 drag-dot : 1 box-dot
        // mapping (no slowing divisor) feels right here.
        const nextWidth = Math.round(clampNum(resize.startLogoWidth + deltaX, MIN_LOGO_DOTS, MAX_LOGO_DOTS))
        const nextHeight = Math.round(clampNum(resize.startLogoHeight + deltaY, MIN_LOGO_DOTS, MAX_LOGO_DOTS))
        setLiveResizeValue({
          key: 'logo',
          font: 0,
          barcodeHeight: 0,
          barcodeModuleWidth: 0,
          logoWidth: nextWidth,
          logoHeight: nextHeight,
        })
      } else {
        const startTextHeight = textHeightDots(resize.startFont)
        const nextFont = Math.round(clampNum((startTextHeight + deltaY - 14) / 6, MIN_FONT, MAX_FONT))
        setLiveResizeValue({ key: resize.key, font: nextFont, barcodeHeight: 0, barcodeModuleWidth: 0, logoWidth: 0, logoHeight: 0 })
      }
    }
  }

  const endInteraction = () => {
    if (drag && livePosition) onMove(drag.key, livePosition.position)
    if (resize && liveResizeValue) {
      if (resize.key === 'barcode') {
        onBarcodeResize({ heightDots: liveResizeValue.barcodeHeight, moduleWidth: liveResizeValue.barcodeModuleWidth })
      } else if (resize.key === 'logo') {
        onLogoResize({ widthDots: liveResizeValue.logoWidth, heightDots: liveResizeValue.logoHeight })
      } else {
        onFontResize(resize.key, liveResizeValue.font)
      }
    }
    setDrag(null)
    setLivePosition(null)
    setResize(null)
    setLiveResizeValue(null)
  }

  const nudge = (key: ElementKey, dx: number, dy: number) => {
    const current = positionOf(key)
    onMove(key, clampToLabel({ x: current.x + dx, y: current.y + dy }, footprintOf(key)))
  }

  const onKeyDownFor = (key: ElementKey) => (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 10 : 1
    if (event.key === 'ArrowLeft') { event.preventDefault(); nudge(key, -step, 0) }
    else if (event.key === 'ArrowRight') { event.preventDefault(); nudge(key, step, 0) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); nudge(key, 0, -step) }
    else if (event.key === 'ArrowDown') { event.preventDefault(); nudge(key, 0, step) }
  }

  const onResizeKeyDownFor = (key: ResizableKey) => (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 10 : 1
    if (key === 'barcode') {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        event.stopPropagation()
        const grow = event.key === 'ArrowUp'
        onBarcodeResize({
          heightDots: Math.round(clampNum(barcodeHeightOf() + (grow ? step : -step), 10, 1000)),
          moduleWidth: barcodeModuleWidthOf(),
        })
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        event.stopPropagation()
        const grow = event.key === 'ArrowRight'
        onBarcodeResize({
          heightDots: barcodeHeightOf(),
          moduleWidth: Math.round(clampNum(barcodeModuleWidthOf() + (grow ? 1 : -1), 1, 10)),
        })
      }
      return
    }
    if (key === 'logo') {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        event.stopPropagation()
        const grow = event.key === 'ArrowUp'
        onLogoResize({
          widthDots: logoWidthOf(),
          heightDots: Math.round(clampNum(logoHeightOf() + (grow ? step : -step), MIN_LOGO_DOTS, MAX_LOGO_DOTS)),
        })
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        event.stopPropagation()
        const grow = event.key === 'ArrowRight'
        onLogoResize({
          widthDots: Math.round(clampNum(logoWidthOf() + (grow ? step : -step), MIN_LOGO_DOTS, MAX_LOGO_DOTS)),
          heightDots: logoHeightOf(),
        })
      }
      return
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    event.stopPropagation()
    const grow = event.key === 'ArrowUp'
    const current = fontOf(key)
    onFontResize(key, clampNum(current + (grow ? 1 : -1), MIN_FONT, MAX_FONT))
  }

  const logoPos = positionOf('logo')
  const namePos = positionOf('name')
  const variationPos = positionOf('variation')
  const barcodePos = positionOf('barcode')
  const skuPos = positionOf('sku')

  const offLabel: string[] = []
  if (logoDataUrl && (logoPos.x + logoWidth > t.widthDots || logoPos.y + logoHeight > t.heightDots)) offLabel.push('Logo')
  if (namePos.x + nameWidth > t.widthDots || namePos.y + nameSize > t.heightDots) offLabel.push('Name')
  if (variationPos.x + variationWidth > t.widthDots || variationPos.y + variationSize > t.heightDots) offLabel.push('Variation')
  if (barcodePos.x + barcodeWidth > t.widthDots || barcodePos.y + barcodeHeight > t.heightDots) offLabel.push('Barcode')
  if (skuPos.x + skuWidth > t.widthDots || skuPos.y + skuSize > t.heightDots) offLabel.push('SKU text')

  const handlePosition = (corner: Corner, width: number, height: number) => ({
    cx: corner === 'ne' || corner === 'se' ? width + 4 : -4,
    cy: corner === 'sw' || corner === 'se' ? height + 4 : -4,
  })

  /** A draggable bounding box with a small tag naming the element, a
   * transparent hit-area covering the whole box (bigger and easier to grab
   * than the thin text/bars it contains), and — for resizable elements — a
   * handle circle at each of the four corners, so there's always one
   * reachable even if the element has been dragged off the label. */
  const draggable = (
    key: ElementKey,
    x: number,
    y: number,
    width: number,
    height: number,
    content: React.ReactNode,
    resizeKey?: ResizableKey,
  ) => (
    <g
      key={key}
      transform={`translate(${x}, ${y})`}
      tabIndex={0}
      role="button"
      aria-label={`${ELEMENT_LABEL[key]} — drag to move, or focus and use arrow keys`}
      onPointerDown={startDrag(key)}
      onKeyDown={onKeyDownFor(key)}
      style={{ cursor: 'grab', outline: 'none' }}
      className={drag?.key === key ? 'label-canvas-dragging' : undefined}
    >
      <rect
        x={-4}
        y={-4}
        width={width + 8}
        height={height + 8}
        fill="rgba(57,211,187,0.06)"
        stroke={drag?.key === key ? '#39d3bb' : 'rgba(57,211,187,0.55)'}
        strokeDasharray={drag?.key === key ? undefined : '5 4'}
        strokeWidth={drag?.key === key ? 2 : 1}
        rx={4}
      />
      <text x={0} y={-7} fontSize={9} fontFamily="ui-sans-serif, system-ui" fill="#39d3bb" style={{ pointerEvents: 'none' }}>
        {ELEMENT_LABEL[key]}
      </text>
      {content}
      {resizeKey &&
        CORNERS.map((corner) => {
          const { cx, cy } = handlePosition(corner, width, height)
          const isActive = resize?.key === resizeKey && resize.corner === corner
          const cursor = corner === 'ne' || corner === 'sw' ? 'nesw-resize' : 'nwse-resize'
          const valueText =
            resizeKey === 'barcode'
              ? `height ${barcodeHeight} dots, width ${barcodeModuleWidth} dots per bar`
              : resizeKey === 'logo'
                ? `width ${logoWidth} dots, height ${logoHeight} dots`
                : `font ${fontOf(resizeKey)}`
          const twoAxis = resizeKey === 'barcode' || resizeKey === 'logo'
          return (
            <circle
              key={corner}
              cx={cx}
              cy={cy}
              r={6}
              fill="#39d3bb"
              stroke="#07111f"
              strokeWidth={1.5}
              tabIndex={0}
              role="slider"
              aria-label={`Resize ${ELEMENT_LABEL[key]} (${corner} handle) — drag${twoAxis ? ', or focus and use the arrow keys for height and width' : ', or focus and press the up/down arrow keys'}`}
              aria-valuetext={valueText}
              onPointerDown={startResize(resizeKey, corner)}
              onKeyDown={onResizeKeyDownFor(resizeKey)}
              className={isActive ? 'label-canvas-dragging' : undefined}
              style={{ cursor }}
            />
          )
        })}
    </g>
  )

  return (
    <div className="label-preview-wrap">
      <svg
        ref={svgRef}
        className="label-preview-svg label-canvas-svg"
        width={px(t.widthDots)}
        height={px(t.heightDots)}
        viewBox={`0 0 ${t.widthDots} ${t.heightDots}`}
        role="group"
        aria-label="Label layout — drag the logo, name, variation, barcode and SKU text to place them"
        onPointerMove={onPointerMove}
        onPointerUp={endInteraction}
        onPointerCancel={endInteraction}
      >
        <rect x={0} y={0} width={t.widthDots} height={t.heightDots} fill="#fff" stroke="#243b55" />

        {logoDataUrl
          ? draggable(
              'logo',
              logoPos.x,
              logoPos.y,
              logoWidth,
              logoHeight,
              <image href={logoDataUrl} width={logoWidth} height={logoHeight} preserveAspectRatio="xMidYMid meet" style={{ pointerEvents: 'none' }} />,
              'logo',
            )
          : draggable(
              'logo',
              logoPos.x,
              logoPos.y,
              logoWidth,
              logoHeight,
              <text x={logoWidth / 2} y={logoHeight / 2 + 4} textAnchor="middle" fontSize={11} fill="#94a3b8" style={{ pointerEvents: 'none' }}>
                (no logo uploaded)
              </text>,
              'logo',
            )}

        {draggable(
          'name',
          namePos.x,
          namePos.y,
          nameWidth,
          nameSize,
          <text x={0} y={nameSize} fontSize={nameSize} fontFamily="ui-monospace, monospace" fill="#0a0a0a" style={{ pointerEvents: 'none' }}>
            {SAMPLE_PRODUCT.name}
          </text>,
          'name',
        )}

        {draggable(
          'variation',
          variationPos.x,
          variationPos.y,
          variationWidth,
          variationSize,
          <text x={0} y={variationSize} fontSize={variationSize} fontFamily="ui-monospace, monospace" fill="#333" style={{ pointerEvents: 'none' }}>
            Variation: {SAMPLE_PRODUCT.variation}
          </text>,
          'variation',
        )}

        {draggable(
          'barcode',
          barcodePos.x,
          barcodePos.y,
          barcodeWidth,
          barcodeHeight,
          <g style={{ pointerEvents: 'none' }}>
            {/* Fake barcode bars — a layout guide, not a real Code 128 encode —
                spaced and sized to track the module width so the preview shows
                roughly how much wider the barcode gets. */}
            {Array.from({ length: 26 }, (_, i) => {
              const barWidth = (i % 3 === 0 ? 3 : 1) * barcodeModuleWidth
              return <rect key={i} x={i * 4 * barcodeModuleWidth} y={0} width={barWidth} height={barcodeHeight} fill="#0a0a0a" />
            })}
          </g>,
          'barcode',
        )}

        {draggable(
          'sku',
          skuPos.x,
          skuPos.y,
          skuWidth,
          skuSize,
          <text x={0} y={skuSize} fontSize={skuSize} fontFamily="ui-monospace, monospace" fill="#333" style={{ pointerEvents: 'none' }}>
            {SAMPLE_PRODUCT.sku}
          </text>,
          'sku',
        )}
      </svg>

      {offLabel.length > 0 && (
        <p className="alert" role="alert">
          {offLabel.join(', ')} {offLabel.length === 1 ? 'runs' : 'run'} past the edge of the label — drag it back to bring it fully on.
        </p>
      )}
    </div>
  )
}

/** Save the current layout under a name, and switch back to any saved one —
 * "Shipping label", "RV", "Product label", whatever's printed differently.
 * Only one layout is ever live/editing at once (above, in `LabelCanvas`);
 * saving copies it into the list under a name, loading copies it back. */
function LabelPresetsPanel({ settings, template }: { settings: SettingsApi; template: LabelTemplate }) {
  const idPrefix = useId()
  const [name, setName] = useState('')

  const save = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    settings.saveLabelPreset(trimmed, template)
    setName('')
  }

  return (
    <section className="panel">
      <h2>Label presets</h2>
      <p className="muted">
        Save the layout above under a name, then load any saved one back whenever you need to
        switch what you're printing for — a shipping label one day, a different product label
        the next. Saving doesn't change what's currently live; only loading does.
      </p>

      {settings.labelPresets.length === 0 ? (
        <p className="empty">No presets saved yet — set up a layout above, then save it below.</p>
      ) : (
        <ul className="plain-list channel-list">
          {settings.labelPresets.map((preset) => (
            <li key={preset.id} className="channel-row">
              <input
                className="channel-rename-input"
                defaultValue={preset.name}
                autoComplete="off"
                aria-label={`Rename ${preset.name}`}
                onKeyDown={commitOnEnter}
                onBlur={(event) => {
                  const next = event.target.value.trim()
                  if (next && next !== preset.name) settings.renameLabelPreset(preset.id, next)
                  else event.target.value = preset.name
                }}
              />
              <div className="toolbar-actions">
                <button type="button" className="button button-ghost" onClick={() => settings.applyLabelPreset(preset.id)}>
                  Load
                </button>
                <button
                  type="button"
                  className="button button-ghost"
                  aria-label={`Delete ${preset.name}`}
                  onClick={() => settings.deleteLabelPreset(preset.id)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form className="toolbar" onSubmit={save}>
        <div className="field field-grow">
          <label htmlFor={`${idPrefix}-preset-name`}>Save current layout as</label>
          <input
            id={`${idPrefix}-preset-name`}
            value={name}
            autoComplete="off"
            placeholder="e.g. Shipping label"
            onChange={(event) => setName(event.target.value)}
          />
          <p className="hint">Saving over an existing name replaces that preset.</p>
        </div>
        <div className="toolbar-actions">
          <button type="submit" className="button button-primary">
            Save preset
          </button>
        </div>
      </form>
    </section>
  )
}

export function LabelTemplateEditor({ settings }: LabelTemplateEditorProps) {
  const idPrefix = useId()
  const template = settings.labelTemplate ?? DEFAULT_LABEL_TEMPLATE
  const [printStatus, setPrintStatus] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)
  const [unit, setUnit] = useState<Unit>('dots')

  const update = (patch: Partial<LabelTemplate>) => {
    settings.setLabelTemplate(sanitiseLabelTemplate({ ...template, ...patch }))
  }

  const numberField = (
    key: keyof typeof FIELD_LIMITS,
    label: string,
    options?: { hint?: string; dimension?: boolean },
  ) => {
    const isDimension = options?.dimension ?? true
    const limits = FIELD_LIMITS[key]
    const fieldId = `${idPrefix}-${key}`
    const rawDots = template[key]

    // In dots, the field's own custom hint (if any) is shown — usually context like
    // "3.00 in at 200 dpi". In inches/mm, that's redundant with the field itself, so
    // show the underlying dots value instead — useful since CPCL commands are dots.
    const hint = isDimension && unit !== 'dots' ? `${rawDots} dots` : options?.hint

    return (
      <DimensionField
        key={key}
        id={fieldId}
        label={label}
        dotsValue={rawDots}
        dpi={template.dpi}
        unit={unit}
        min={limits.min}
        max={limits.max}
        isDimension={isDimension}
        hint={hint}
        onCommit={(dots) => update({ [key]: dots } as Partial<LabelTemplate>)}
      />
    )
  }

  const fontField = (key: 'nameFont' | 'variationFont' | 'skuFont', label: string) => {
    const fieldId = `${idPrefix}-${key}`
    return (
      <div className="field" key={key}>
        <label htmlFor={fieldId}>{label}</label>
        <select
          id={fieldId}
          value={template[key]}
          onChange={(event) => update({ [key]: Number(event.target.value) } as Partial<LabelTemplate>)}
        >
          {Array.from({ length: MAX_FONT - MIN_FONT + 1 }, (_, i) => MIN_FONT + i).map((font) => (
            <option key={font} value={font}>
              Font {font}
            </option>
          ))}
        </select>
      </div>
    )
  }

  const printTest = async () => {
    setPrinting(true)
    setPrintStatus('Sending test label to the printer…')
    const result = await printProductLabel(SAMPLE_PRODUCT, {
      logoDataUrl: settings.logoDataUrl,
      saleChannels: settings.saleChannels,
      labelPresets: settings.labelPresets,
      labelTemplate: template,
    })
    setPrintStatus(result.ok ? 'Test label sent to the printer.' : `Print failed: ${result.error}`)
    setPrinting(false)
  }

  return (
    <>
    <section className="panel">
      <h2>Label template</h2>
      <p className="muted">
        Drag the logo, name, variation, barcode and SKU text to where you want them on the label —
        or focus one and use the arrow keys to nudge it. Each resizable element has a handle at
        every corner, so there's always one you can grab even if it's been dragged towards the
        edge. Drag a corner to resize (up/down arrows when focused); for the barcode and the logo,
        dragging sideways — or the left/right arrow keys — resizes width instead of height. The
        logo is scaled to fit its box without stretching, so resizing it never distorts it.
        Changes are saved as you go and used the next time a label is printed.
      </p>

      <LabelCanvas
        template={template}
        logoDataUrl={settings.logoDataUrl}
        onMove={(key, position) => update({ [key]: position } as Partial<LabelTemplate>)}
        onFontResize={(key, font) => update({ [FONT_FIELD[key]]: font } as Partial<LabelTemplate>)}
        onBarcodeResize={({ heightDots, moduleWidth }) => update({ barcodeHeight: heightDots, barcodeModuleWidth: moduleWidth })}
        onLogoResize={({ widthDots, heightDots }) => update({ logoWidthDots: widthDots, logoHeightDots: heightDots })}
      />

      <div className="field-row label-template-grid">
        <div className="field">
          <label htmlFor={`${idPrefix}-unit`}>Units</label>
          <select
            id={`${idPrefix}-unit`}
            value={unit}
            onChange={(event) => setUnit(event.target.value as Unit)}
          >
            {UNIT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="hint">Sizes are still stored and sent to the printer in dots.</span>
        </div>
        {numberField('dpi', 'Printer DPI', {
          dimension: false,
          hint: "Must match your printer's real resolution (check its spec sheet or a printed config label) — if this is wrong, every inch/mm size below prints the wrong physical size no matter how you adjust it. The Zebra QLn220 is 203 dpi.",
        })}
      </div>

      <div className="field-row label-template-grid">
        {numberField('widthDots', 'Label width', {
          hint: `${(template.widthDots / template.dpi).toFixed(2)} in at ${template.dpi} dpi`,
        })}
        {numberField('heightDots', 'Label length', {
          hint: `${(template.heightDots / template.dpi).toFixed(2)} in at ${template.dpi} dpi`,
        })}
        {numberField('barcodeHeight', 'Barcode height')}
        {numberField('barcodeModuleWidth', 'Barcode width (per bar)')}
      </div>

      <div className="field-row label-template-grid">
        {numberField('logoWidthDots', 'Logo width')}
        {numberField('logoHeightDots', 'Logo height')}
      </div>

      <div className="field-row label-template-grid">
        {fontField('nameFont', 'Name font')}
        {fontField('variationFont', 'Variation font')}
        {fontField('skuFont', 'SKU text font')}
      </div>

      <div className="dialog-actions">
        <button type="button" className="button button-ghost" onClick={() => settings.resetLabelTemplate()}>
          Reset to defaults
        </button>
        <button type="button" className="button button-primary" onClick={printTest} disabled={printing}>
          {printing ? 'Printing…' : 'Print test label'}
        </button>
      </div>

      {printStatus && <p className="preview">{printStatus}</p>}
    </section>

    <LabelPresetsPanel settings={settings} template={template} />
    </>
  )
}
