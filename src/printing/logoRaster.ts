import type { RasterImage } from './bitmap'

/** Kept a multiple of 8 so it packs into whole bytes with no padding waste. */
const TARGET_WIDTH = 120

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not load the logo image.'))
    image.src = src
  })
}

/** Draws the uploaded logo onto an offscreen canvas and reads back its pixels. */
export async function rasterizeLogo(dataUrl: string): Promise<RasterImage> {
  const image = await loadImage(dataUrl)
  const scale = TARGET_WIDTH / image.width
  const width = TARGET_WIDTH
  const height = Math.max(1, Math.round(image.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available to render the logo.')

  // White background so transparent logo pixels print as blank, not black.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(image, 0, 0, width, height)

  const { data } = ctx.getImageData(0, 0, width, height)
  return { width, height, data }
}
