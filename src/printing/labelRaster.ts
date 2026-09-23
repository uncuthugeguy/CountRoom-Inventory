import { labelFont, type LabelPlan, type MeasureText } from './barcodeLabelPlan'
import type { LabelMedia } from './labelMedia'

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

export interface PrinterCalibration {
  /** Shift everything right (+) or left (−), in dots. */
  offsetX: number
  /** Shift everything down (+) or up (−), in dots. */
  offsetY: number
  /** Turn the printed image — for drivers that feed the label sideways or upside-down. */
  rotation: LabelRotation
}

export const DEFAULT_CALIBRATION: PrinterCalibration = { offsetX: 0, offsetY: 0, rotation: 0 }

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

/**
 * Applies this device's printer calibration (nudge + rotation) to a
 * finished label and returns it with the physical page size to print at.
 * Rotating by 90/270 swaps the page's width and height.
 */
export function applyCalibration(label: HTMLCanvasElement, media: LabelMedia, cal: PrinterCalibration): PrintPage {
  const W = media.widthDots
  const H = media.heightDots
  const sideways = cal.rotation === 90 || cal.rotation === 270
  const out = createCanvas(sideways ? H : W, sideways ? W : H)
  const ctx = context2d(out)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.imageSmoothingEnabled = false
  ctx.save()
  if (cal.rotation === 90) ctx.setTransform(0, 1, -1, 0, H, 0)
  else if (cal.rotation === 180) ctx.setTransform(-1, 0, 0, -1, W, H)
  else if (cal.rotation === 270) ctx.setTransform(0, -1, 1, 0, 0, W)
  ctx.drawImage(label, Math.round(cal.offsetX), Math.round(cal.offsetY))
  ctx.restore()
  return {
    canvas: out,
    widthIn: sideways ? media.heightIn : media.widthIn,
    heightIn: sideways ? media.widthIn : media.heightIn,
  }
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
