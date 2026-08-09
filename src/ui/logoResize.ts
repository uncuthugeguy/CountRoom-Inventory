/**
 * The logo is only ever printed at ~120 dots wide (see `logoRaster.ts`) and
 * shown at most 220px wide in the settings preview, so there is no reason to
 * keep a phone photo's full multi-megabyte resolution around. Storing that
 * as-is in `localStorage` (shared with every other setting, in a handful of
 * MB of total quota) is what throws "exceeded the quota" — so every upload
 * is downscaled and recompressed here before it's ever saved.
 */

/** Comfortably above anything printing or preview needs, while keeping the
 * resulting data URL small — a resized photo lands well under 200KB. */
const MAX_DIMENSION = 480

const PRESERVE_TRANSPARENCY_TYPES = new Set(['image/png', 'image/gif', 'image/webp', 'image/svg+xml'])

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not read that image.'))
    image.src = src
  })
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read that file.'))
    reader.readAsDataURL(file)
  })
}

/**
 * Downscales an uploaded image to a storage-friendly size and re-encodes it
 * — PNG when the source format can carry transparency (so simple logos with
 * a transparent background still look right), JPEG otherwise, since a
 * downscaled photo re-encoded as PNG is often still far larger than it
 * needs to be.
 */
export async function resizeLogoForStorage(file: File): Promise<string> {
  const original = await readAsDataUrl(file)
  const image = await loadImage(original)

  const scale = Math.min(1, MAX_DIMENSION / Math.max(image.width, image.height))
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available to resize the logo.')

  const keepsTransparency = PRESERVE_TRANSPARENCY_TYPES.has(file.type)
  if (!keepsTransparency) {
    // JPEG has no alpha channel — fill white first so it doesn't default to black.
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
  }
  ctx.drawImage(image, 0, 0, width, height)

  return keepsTransparency ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85)
}
