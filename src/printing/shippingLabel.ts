import { LABEL_MEDIA } from './labelMedia'
import { context2d, createCanvas, loadImage, thresholdPixels } from './labelRaster'

/**
 * Turns a carrier label (eBay, Royal Mail Click & Drop, Evri… — a PDF or an
 * image) into a crisp 4 × 6 in label at the Polono's 203 dpi.
 *
 * The page is first drawn at preview size so the label can be found and
 * cropped. When printing, the page is drawn *again* at exactly the scale
 * that makes the crop land 1:1 on printer dots, so the carrier's barcodes
 * are never resampled — resampling a barcode and then thresholding it is
 * how bars end up merged or broken and the label won't scan at the depot.
 */

export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

export type ShippingRotation = 'auto' | 0 | 90 | 180 | 270

export interface ShippingSource {
  fileName: string
  pageCount: number
  /** Draws one page. `scale` 1 = 72 dpi for a PDF, natural size for an image. */
  renderPage(pageIndex: number, scale: number): Promise<HTMLCanvasElement>
  /** Page size at scale 1. */
  pageSize(pageIndex: number): Promise<{ width: number; height: number }>
  close(): void
}

/** Long side of the on-screen preview render, in pixels. */
export const PREVIEW_LONG_SIDE = 1400
/** Keeps any single render inside the smallest browser canvas limit (Safari's ~16.7M pixels). */
const MAX_RENDER_PIXELS = 16_000_000

export const isPdfFile = (file: File): boolean =>
  file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

export async function openShippingSource(file: File): Promise<ShippingSource> {
  if (isPdfFile(file)) return openPdf(file)
  if (file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name)) return openImage(file)
  throw new Error('Choose a PDF or an image (PNG or JPG) of the shipping label.')
}

async function openPdf(file: File): Promise<ShippingSource> {
  // Loaded on demand — pdf.js is large and only this screen needs it. The
  // legacy build carries the polyfills older WebViews (Electron, iOS) need.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const doc = await loadingTask.promise
  return {
    fileName: file.name,
    pageCount: doc.numPages,
    async pageSize(pageIndex) {
      const page = await doc.getPage(pageIndex + 1)
      const vp = page.getViewport({ scale: 1 })
      return { width: vp.width, height: vp.height }
    },
    async renderPage(pageIndex, scale) {
      const page = await doc.getPage(pageIndex + 1)
      const viewport = page.getViewport({ scale })
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      const ctx = context2d(canvas)
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, canvasContext: ctx, viewport }).promise
      return canvas
    },
    close() {
      void loadingTask.destroy()
    },
  }
}

async function openImage(file: File): Promise<ShippingSource> {
  const url = URL.createObjectURL(file)
  let image: HTMLImageElement
  try {
    image = await loadImage(url)
  } finally {
    URL.revokeObjectURL(url)
  }
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  return {
    fileName: file.name,
    pageCount: 1,
    pageSize: async () => ({ width, height }),
    async renderPage(_pageIndex, scale) {
      const canvas = createCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)))
      const ctx = context2d(canvas)
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      return canvas
    },
    close() {},
  }
}

export async function previewScaleFor(source: ShippingSource, pageIndex: number): Promise<number> {
  const { width, height } = await source.pageSize(pageIndex)
  return PREVIEW_LONG_SIDE / Math.max(width, height, 1)
}

/**
 * Bounding box of everything that isn't (near-)white, padded a little and
 * kept inside the image. Returns the whole image if it's blank.
 */
export function findContentBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options: { threshold?: number; padding?: number } = {},
): CropRect {
  const threshold = options.threshold ?? 200
  const padding = options.padding ?? 6
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const a = data[i + 3] / 255
      const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) * a + 255 * (1 - a)
      if (lum < threshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: width, h: height }
  const x = Math.max(0, minX - padding)
  const y = Math.max(0, minY - padding)
  return {
    x,
    y,
    w: Math.min(width, maxX + 1 + padding) - x,
    h: Math.min(height, maxY + 1 + padding) - y,
  }
}

/**
 * A page that's already 4 × 6 (either way round) is a label made for this
 * stock — print it whole, margins and all. The margins are the barcodes'
 * quiet zones; trimming them and scaling up can make a label unscannable.
 */
export function isFourBySixPage(width: number, height: number): boolean {
  const ratio = Math.max(width, height) / Math.min(width, height)
  return Math.abs(ratio - 1.5) < 0.04
}

/** Finds the label on a page (e.g. the label part of an A4 sheet). */
export function autoCrop(canvas: HTMLCanvasElement): CropRect {
  const img = context2d(canvas).getImageData(0, 0, canvas.width, canvas.height)
  // Generous padding (~1.5% of the page) so barcodes keep their quiet zones.
  const padding = Math.max(6, Math.round(Math.max(canvas.width, canvas.height) * 0.015))
  return findContentBounds(img.data, canvas.width, canvas.height, { padding })
}

/** Starting crop: the whole page for a 4 × 6 page, otherwise the printed area. */
export function initialCrop(canvas: HTMLCanvasElement): CropRect {
  return isFourBySixPage(canvas.width, canvas.height)
    ? { x: 0, y: 0, w: canvas.width, h: canvas.height }
    : autoCrop(canvas)
}

/** 'auto' turns a landscape crop sideways so it fills the portrait 4 × 6 label. */
export const resolveRotation = (rotation: ShippingRotation, crop: CropRect): 0 | 90 | 180 | 270 =>
  rotation === 'auto' ? (crop.w > crop.h ? 90 : 0) : rotation

/**
 * How big the crop ends up on the label: scaled to fit 4 × 6 without
 * stretching, centred. `fit` is output dots per preview pixel.
 */
export function fitCropToLabel(crop: CropRect, rotation: 0 | 90 | 180 | 270): { fit: number; drawW: number; drawH: number } {
  const { widthDots: W, heightDots: H } = LABEL_MEDIA['4x6']
  const sideways = rotation === 90 || rotation === 270
  const cw = sideways ? crop.h : crop.w
  const ch = sideways ? crop.w : crop.h
  const fit = Math.min(W / cw, H / ch)
  return { fit, drawW: crop.w * fit, drawH: crop.h * fit }
}

/**
 * Builds the final 812 × 1218 black/white label from one page of the source.
 * `crop` is in preview pixels (the render at `previewScale`).
 */
export async function composeShippingLabel(
  source: ShippingSource,
  pageIndex: number,
  previewScale: number,
  crop: CropRect,
  rotation: ShippingRotation,
): Promise<HTMLCanvasElement> {
  const { widthDots: W, heightDots: H } = LABEL_MEDIA['4x6']
  const rot = resolveRotation(rotation, crop)
  const { fit, drawW, drawH } = fitCropToLabel(crop, rot)

  // Redraw the page so the crop comes out at (close to) one source pixel per
  // printer dot — capped so a tiny crop of a big page can't blow the canvas limit.
  const page = await source.pageSize(pageIndex)
  let scale = previewScale * fit
  const pixels = page.width * scale * page.height * scale
  if (pixels > MAX_RENDER_PIXELS) scale *= Math.sqrt(MAX_RENDER_PIXELS / pixels)
  const hiRes = await source.renderPage(pageIndex, scale)
  const k = scale / previewScale

  const out = createCanvas(W, H)
  const ctx = context2d(out)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, W, H)
  ctx.imageSmoothingQuality = 'high'
  ctx.save()
  ctx.translate(W / 2, H / 2)
  ctx.rotate((rot * Math.PI) / 180)
  ctx.drawImage(hiRes, crop.x * k, crop.y * k, crop.w * k, crop.h * k, -drawW / 2, -drawH / 2, drawW, drawH)
  ctx.restore()

  const img = ctx.getImageData(0, 0, W, H)
  thresholdPixels(img.data, 170)
  ctx.putImageData(img, 0, 0)
  return out
}
