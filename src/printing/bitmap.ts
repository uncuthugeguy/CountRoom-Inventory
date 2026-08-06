/** A 1-bit-per-pixel raster, packed row-major, ready for CPCL's EG command. */
export interface CpclLogo {
  /** Row width in bytes (CPCL's EG command wants width in bytes, not pixels). */
  widthBytes: number
  heightDots: number
  /** Uppercase hex encoding of the packed bytes, row by row. */
  hex: string
}

export interface RasterImage {
  width: number
  height: number
  /** RGBA bytes, length === width * height * 4. */
  data: ArrayLike<number>
}

/**
 * Converts an RGBA raster to the packed monochrome bitmap CPCL's EG command
 * expects: one bit per pixel, dark pixels set, 8 pixels to a byte, rows
 * padded up to a whole byte. Transparent pixels count as light (unset).
 */
export function toMonochromeBitmap(image: RasterImage, threshold = 128): CpclLogo {
  const widthBytes = Math.ceil(image.width / 8)
  const bytes = new Uint8Array(widthBytes * image.height)

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4
      const r = image.data[i]
      const g = image.data[i + 1]
      const b = image.data[i + 2]
      const a = image.data[i + 3]
      const luminance = r * 0.299 + g * 0.587 + b * 0.114
      const dark = a > 0 && luminance < threshold
      if (dark) {
        const byteIndex = y * widthBytes + (x >> 3)
        bytes[byteIndex] |= 0x80 >> (x & 7)
      }
    }
  }

  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')

  return { widthBytes, heightDots: image.height, hex: hex.toUpperCase() }
}
