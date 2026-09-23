import { labelFont, type LabelPlan, type MeasureText } from './barcodeLabelPlan'
import { POLONO_DPI, dotsToMm, type LabelMedia } from './labelMedia'

/**
 * Canvas side of label printing: paints a plan onto a bitmap that is exactly
 * one pixel per printer dot, then forces every pixel to pure black or white.
 *
 * Why pure black/white: the Polono is a direct thermal printer — a dot is
 * either burnt or not. If the driver receives grey anti-aliased edges it
 * dithers them, which is what makes small text look fuzzy and barcodes
 * print with ragged bar edges. Doing the black/white decision here, at the
 * printer's own resolution, means the driver has nothing left to guess.
 */

export type LabelRotation = 0 | 90 | 180 | 270

/**
 * Where the label physically sits under the printhead, for one label size.
 *
 * Why this exists: the Polono's printhead is ~4 in wide, and the driver
 * lines a narrower page up with the *left* end of the head — but a 2 in
 * roll sits further in, wherever the paper guides put it. Sending a 2 in
 * page therefore printed the left of the label onto thin air and left the
 * right half of the real label blank. So the page sent to the printer is
 * always the full head width, with the label drawn at the position the
 * roll actually sits (measured once with the ruler test).
 */
export interface PrinterCalibration {
  /** Label's left edge, in dots from the printhead's left edge. `null` = centred on the head. */
  leftDots: number | null
  /** Shift everything down (+) or up (−), in dots. */
  offsetY: number
  /** Turn the printed image — for drivers that feed the label sideways or upside-down. */
  rotation: LabelRotation
}

export const DEFAULT_CALIBRATION: PrinterCalibration = { leftDots: null, offsetY: 0, rotation: 0 }

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

export function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('This device can’t draw labels (no canvas support).')
  return ctx
}

/** A `MeasureText` backed by a real canvas — the same font engine that paints. */
export function canvasMeasure(): MeasureText {
  const ctx = context2d(createCanvas(1, 1))
  return (text, px, bold) => {
    ctx.font = labelFont(px, bold)
    return ctx.measureText(text).width
  }
}

/** Luminance of an RGBA pixel composited over white. */
const luminance = (d: Uint8ClampedArray, i: number): number => {
  const a = d[i + 3] / 255
  const r = d[i] * a + 255 * (1 - a)
  const g = d[i + 1] * a + 255 * (1 - a)
  const b = d[i + 2] * a + 255 * (1 - a)
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/**
 * Hard black/white cut. The threshold sits a little above mid-grey so
 * anti-aliased text edges fall on the dark side — thermal prints look
 * slightly lighter than the screen, and this keeps small text solid.
 */
export function thresholdPixels(data: Uint8ClampedArray, threshold = 160): void {
  for (let i = 0; i < data.length; i += 4) {
    const v = luminance(data, i) < threshold ? 0 : 255
    data[i] = data[i + 1] = data[i + 2] = v
    data[i + 3] = 255
  }
}

/** Atkinson dithering — keeps photos/gradients in a logo recognisable in pure black/white. */
export function ditherPixels(data: Uint8ClampedArray, width: number, height: number): void {
  const lum = new Float32Array(width * height)
  for (let p = 0; p < lum.length; p++) lum[p] = luminance(data, p * 4)
  const spread: [number, number][] = [[1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2]]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      const old = lum[p]
      const v = old < 128 ? 0 : 255
      const err = (old - v) / 8
      lum[p] = v
      for (const [dx, dy] of spread) {
        const nx = x + dx
        const ny = y + dy
        if (nx >= 0 && nx < width && ny < height) lum[ny * width + nx] += err
      }
    }
  }
  for (let p = 0; p < lum.length; p++) {
    const i = p * 4
    data[i] = data[i + 1] = data[i + 2] = lum[p]
    data[i + 3] = 255
  }
}

function drawLogo(ctx: CanvasRenderingContext2D, logo: CanvasImageSource, box: { x: number; y: number; w: number; h: number }) {
  const srcW = (logo as { width: number }).width || box.w
  const srcH = (logo as { height: number }).height || box.h
  const scale = Math.min(box.w / srcW, box.h / srcH)
  const w = Math.max(1, Math.round(srcW * scale))
  const h = Math.max(1, Math.round(srcH * scale))
  const tmp = createCanvas(w, h)
  const tctx = context2d(tmp)
  tctx.fillStyle = '#fff'
  tctx.fillRect(0, 0, w, h)
  tctx.imageSmoothingQuality = 'high'
  tctx.drawImage(logo, 0, 0, w, h)
  const img = tctx.getImageData(0, 0, w, h)
  ditherPixels(img.data, w, h)
  ctx.putImageData(img, Math.round(box.x + (box.w - w) / 2), Math.round(box.y + (box.h - h) / 2))
}

/** Paints a plan onto a new 1-bit-looking canvas at printer resolution. */
export function paintLabelPlan(plan: LabelPlan, logo?: CanvasImageSource): HTMLCanvasElement {
  const canvas = createCanvas(plan.width, plan.height)
  const ctx = context2d(canvas)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, plan.width, plan.height)

  for (const op of plan.ops) {
    if (op.kind === 'text') {
      ctx.fillStyle = '#000'
      ctx.font = labelFont(op.fontPx, op.bold)
      ctx.textAlign = op.align
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(op.text, op.x, op.y)
    } else if (op.kind === 'bars') {
      ctx.fillStyle = '#000'
      for (const [x, w] of op.runs) ctx.fillRect(x, op.y, w, op.h)
    }
  }

  // Everything drawn so far is crisp line art: hard threshold it. The logo
  // goes on afterwards, already dithered, so it isn't flattened to a blob.
  const img = ctx.getImageData(0, 0, plan.width, plan.height)
  thresholdPixels(img.data)
  ctx.putImageData(img, 0, 0)

  const logoOp = plan.ops.find((op) => op.kind === 'logo')
  if (logoOp && logoOp.kind === 'logo' && logo) drawLogo(ctx, logo, logoOp)

  return canvas
}

/** Page size handed to the print system, after any rotation. */
export interface PrintPage {
  canvas: HTMLCanvasElement
  widthIn: number
  heightIn: number
}

/** Rotates a finished label by a multiple of 90°. */
export function rotateCanvas(label: HTMLCanvasElement, rotation: LabelRotation): HTMLCanvasElement {
  if (rotation === 0) return label
  const W = label.width
  const H = label.height
  const sideways = rotation === 90 || rotation === 270
  const out = createCanvas(sideways ? H : W, sideways ? W : H)
  const ctx = context2d(out)
  ctx.imageSmoothingEnabled = false
  if (rotation === 90) ctx.setTransform(0, 1, -1, 0, H, 0)
  else if (rotation === 180) ctx.setTransform(-1, 0, 0, -1, W, H)
  else ctx.setTransform(0, -1, 1, 0, 0, W)
  ctx.drawImage(label, 0, 0)
  return out
}

/** Where the label's left edge lands on a page `pageW` dots wide. */
export function labelLeftOnPage(pageW: number, labelW: number, leftDots: number | null): number {
  const room = Math.max(0, pageW - labelW)
  if (leftDots === null) return Math.round(room / 2)
  return Math.min(room, Math.max(0, Math.round(leftDots)))
}

/**
 * Places a finished label on a page the full width of the printhead, at the
 * position the roll sits, applying this device's rotation and vertical nudge.
 */
export function applyCalibration(
  label: HTMLCanvasElement,
  cal: PrinterCalibration,
  headWidthDots: number,
): PrintPage {
  const turned = rotateCanvas(label, cal.rotation)
  const pageW = Math.max(headWidthDots, turned.width)
  const pageH = turned.height
  const out = createCanvas(pageW, pageH)
  const ctx = context2d(out)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, pageW, pageH)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(turned, labelLeftOnPage(pageW, turned.width, cal.leftDots), Math.round(cal.offsetY))
  return { canvas: out, widthIn: pageW / POLONO_DPI, heightIn: pageH / POLONO_DPI }
}

/**
 * A millimetre ruler across the whole printhead, printed on whatever label
 * is loaded. The number at the label's left edge is where the roll sits —
 * type it into Printer setup and every label lands exactly on the paper.
 */
export function paintRulerTest(headWidthDots: number, heightDots: number): HTMLCanvasElement {
  const canvas = createCanvas(headWidthDots, heightDots)
  const ctx = context2d(canvas)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, headWidthDots, heightDots)
  ctx.fillStyle = '#000'
  const top = 10
  ctx.fillRect(0, top, headWidthDots, 2)
  const mmCount = Math.floor(dotsToMm(headWidthDots))
  const numberPx = Math.max(16, Math.min(28, Math.round(heightDots / 8)))
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (let mm = 0; mm <= mmCount; mm++) {
    const x = Math.round((mm / 25.4) * POLONO_DPI)
    const len = mm % 10 === 0 ? 46 : mm % 5 === 0 ? 30 : 16
    ctx.fillRect(Math.min(x, headWidthDots - 2), top, 2, len)
    if (mm % 5 === 0 && mm > 0) {
      ctx.font = labelFont(mm % 10 === 0 ? numberPx : Math.round(numberPx * 0.75), mm % 10 === 0)
      ctx.fillText(String(mm), x, top + len + 4)
    }
  }
  // A second, bolder scale lower down, numbered every 10 mm, in case the top
  // of the label is hard to read.
  const y2 = Math.round(heightDots * 0.62)
  ctx.fillRect(0, y2, headWidthDots, 2)
  ctx.font = labelFont(numberPx, true)
  for (let mm = 0; mm <= mmCount; mm += 2) {
    const x = Math.round((mm / 25.4) * POLONO_DPI)
    ctx.fillRect(Math.min(x, headWidthDots - 2), y2, 2, mm % 10 === 0 ? 30 : 12)
    if (mm % 10 === 0 && mm > 0 && y2 + 34 + numberPx <= heightDots) ctx.fillText(String(mm), x, y2 + 34)
  }
  const img = ctx.getImageData(0, 0, headWidthDots, heightDots)
  thresholdPixels(img.data)
  ctx.putImageData(img, 0, 0)
  return canvas
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not load that image.'))
    image.src = src
  })
}

/** A plain alignment pattern: border, centre cross and corner ticks — print
 * it to see exactly how the printer lines up with the label edges. */
export function paintAlignmentTest(media: LabelMedia): HTMLCanvasElement {
  const { widthDots: W, heightDots: H } = media
  const canvas = createCanvas(W, H)
  const ctx = context2d(canvas)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#000'
  const t = 3
  // Border 8 dots (1 mm) in from each edge.
  const inset = 8
  ctx.fillRect(inset, inset, W - inset * 2, t)
  ctx.fillRect(inset, H - inset - t, W - inset * 2, t)
  ctx.fillRect(inset, inset, t, H - inset * 2)
  ctx.fillRect(W - inset - t, inset, t, H - inset * 2)
  // Centre cross.
  ctx.fillRect(Math.round(W / 2) - 1, Math.round(H / 2) - 30, 2, 60)
  ctx.fillRect(Math.round(W / 2) - 30, Math.round(H / 2) - 1, 60, 2)
  ctx.font = labelFont(Math.round(Math.min(W, H) / 8), true)
  ctx.textAlign = 'center'
  ctx.fillText(media.size === '2x1' ? '2 × 1 TEST' : '4 × 6 TEST', W / 2, Math.round(H / 2) - 40)
  ctx.font = labelFont(Math.round(Math.min(W, H) / 12), false)
  ctx.fillText('Box should sit 1 mm inside the edges', W / 2, Math.round(H / 2) + 40 + Math.round(Math.min(W, H) / 12))
  const img = ctx.getImageData(0, 0, W, H)
  thresholdPixels(img.data)
  ctx.putImageData(img, 0, 0)
  return canvas
}
