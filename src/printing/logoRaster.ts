import type { RasterImage } from './bitmap'

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not load the logo image.'))
    image.src = src
  })
}

/**
 * Draws the uploaded logo onto an offscreen canvas sized exactly
 * `targetWidth` x `targetHeight` and reads back its pixels, ready for
 * `toMonochromeBitmap`.
 *
 * Scaled to fit *within* that box, preserving the logo's own aspect ratio —
 * centred, with the leftover space filled white — rather than stretched to
 * fill it. This is the same "meet" behaviour the editor's SVG preview uses
 * (`preserveAspectRatio="xMidYMid meet"`), so resizing the logo's box in the
 * editor changes the printed result exactly the way the preview showed,
 * with the logo itself never distorted.
 */
export async function rasterizeLogo(dataUrl: string, targetWidth: number, targetHeight: number): Promise<RasterImage> {
  const image = await loadImage(dataUrl)
  const width = Math.max(1, Math.round(targetWidth))
  const height = Math.max(1, Math.round(targetHeight))

  const scale = Math.min(width / image.width, height / image.height)
  const drawWidth = Math.max(1, Math.round(image.width * scale))
  const drawHeight = Math.max(1, Math.round(image.height * scale))
  const offsetX = Math.round((width - drawWidth) / 2)
  const offsetY = Math.round((height - drawHeight) / 2)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available to render the logo.')

  // White background so transparent logo pixels (and any letterbox padding)
  // print as blank, not black.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight)

  const { data } = ctx.getImageData(0, 0, width, height)
  return { width, height, data }
}
