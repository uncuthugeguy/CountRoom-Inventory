/**
 * Code 128 (Code Set B) encoding for on-screen display — the counterpart to
 * `qrRender.ts` for the older, non-QR "settings barcodes" some printer and
 * device manuals use (see `domain/quickCodes.ts`).
 *
 * `@zxing/library` (already a dependency, used for camera scanning) ships a
 * *decoder* for Code 128 but no *encoder*, so this hand-rolls one. To avoid
 * transcription errors in the bar-width table — a single wrong digit would
 * silently produce a barcode that looks fine on screen but never scans —
 * `CODE128_PATTERNS` below is copied verbatim from zxing's own
 * `Code128Reader.CODE_PATTERNS`, and `code128Render.test.ts` round-trips
 * every encoded value back through zxing's real `Code128Reader` to prove
 * the two stay in lockstep.
 */

/**
 * Bar/space widths (in modules) for every Code 128 symbol value, indexed by
 * that value: 0–94 are Code Set B's printable characters (ASCII 32–126),
 * 95–102 are shift/function codes (unused here), 103–105 are the three
 * start codes, and 106 is the stop pattern (7 widths instead of 6 — every
 * other symbol is 6). Sourced from zxing's `Code128Reader.CODE_PATTERNS`.
 */
const CODE128_PATTERNS: readonly number[][] = [
  [2, 1, 2, 2, 2, 2], [2, 2, 2, 1, 2, 2], [2, 2, 2, 2, 2, 1], [1, 2, 1, 2, 2, 3],
  [1, 2, 1, 3, 2, 2], [1, 3, 1, 2, 2, 2], [1, 2, 2, 2, 1, 3], [1, 2, 2, 3, 1, 2],
  [1, 3, 2, 2, 1, 2], [2, 2, 1, 2, 1, 3], [2, 2, 1, 3, 1, 2], [2, 3, 1, 2, 1, 2],
  [1, 1, 2, 2, 3, 2], [1, 2, 2, 1, 3, 2], [1, 2, 2, 2, 3, 1], [1, 1, 3, 2, 2, 2],
  [1, 2, 3, 1, 2, 2], [1, 2, 3, 2, 2, 1], [2, 2, 3, 2, 1, 1], [2, 2, 1, 1, 3, 2],
  [2, 2, 1, 2, 3, 1], [2, 1, 3, 2, 1, 2], [2, 2, 3, 1, 1, 2], [3, 1, 2, 1, 3, 1],
  [3, 1, 1, 2, 2, 2], [3, 2, 1, 1, 2, 2], [3, 2, 1, 2, 2, 1], [3, 1, 2, 2, 1, 2],
  [3, 2, 2, 1, 1, 2], [3, 2, 2, 2, 1, 1], [2, 1, 2, 1, 2, 3], [2, 1, 2, 3, 2, 1],
  [2, 3, 2, 1, 2, 1], [1, 1, 1, 3, 2, 3], [1, 3, 1, 1, 2, 3], [1, 3, 1, 3, 2, 1],
  [1, 1, 2, 3, 1, 3], [1, 3, 2, 1, 1, 3], [1, 3, 2, 3, 1, 1], [2, 1, 1, 3, 1, 3],
  [2, 3, 1, 1, 1, 3], [2, 3, 1, 3, 1, 1], [1, 1, 2, 1, 3, 3], [1, 1, 2, 3, 3, 1],
  [1, 3, 2, 1, 3, 1], [1, 1, 3, 1, 2, 3], [1, 1, 3, 3, 2, 1], [1, 3, 3, 1, 2, 1],
  [3, 1, 3, 1, 2, 1], [2, 1, 1, 3, 3, 1], [2, 3, 1, 1, 3, 1], [2, 1, 3, 1, 1, 3],
  [2, 1, 3, 3, 1, 1], [2, 1, 3, 1, 3, 1], [3, 1, 1, 1, 2, 3], [3, 1, 1, 3, 2, 1],
  [3, 3, 1, 1, 2, 1], [3, 1, 2, 1, 1, 3], [3, 1, 2, 3, 1, 1], [3, 3, 2, 1, 1, 1],
  [3, 1, 4, 1, 1, 1], [2, 2, 1, 4, 1, 1], [4, 3, 1, 1, 1, 1], [1, 1, 1, 2, 2, 4],
  [1, 1, 1, 4, 2, 2], [1, 2, 1, 1, 2, 4], [1, 2, 1, 4, 2, 1], [1, 4, 1, 1, 2, 2],
  [1, 4, 1, 2, 2, 1], [1, 1, 2, 2, 1, 4], [1, 1, 2, 4, 1, 2], [1, 2, 2, 1, 1, 4],
  [1, 2, 2, 4, 1, 1], [1, 4, 2, 1, 1, 2], [1, 4, 2, 2, 1, 1], [2, 4, 1, 2, 1, 1],
  [2, 2, 1, 1, 1, 4], [4, 1, 3, 1, 1, 1], [2, 4, 1, 1, 1, 2], [1, 3, 4, 1, 1, 1],
  [1, 1, 1, 2, 4, 2], [1, 2, 1, 1, 4, 2], [1, 2, 1, 2, 4, 1], [1, 1, 4, 2, 1, 2],
  [1, 2, 4, 1, 1, 2], [1, 2, 4, 2, 1, 1], [4, 1, 1, 2, 1, 2], [4, 2, 1, 1, 1, 2],
  [4, 2, 1, 2, 1, 1], [2, 1, 2, 1, 4, 1], [2, 1, 4, 1, 2, 1], [4, 1, 2, 1, 2, 1],
  [1, 1, 1, 1, 4, 3], [1, 1, 1, 3, 4, 1], [1, 3, 1, 1, 4, 1], [1, 1, 4, 1, 1, 3],
  [1, 1, 4, 3, 1, 1], [4, 1, 1, 1, 1, 3], [4, 1, 1, 3, 1, 1], [1, 1, 3, 1, 4, 1],
  [1, 1, 4, 1, 3, 1], [3, 1, 1, 1, 4, 1], [4, 1, 1, 1, 3, 1], [2, 1, 1, 4, 1, 2],
  [2, 1, 1, 2, 1, 4], [2, 1, 1, 2, 3, 2], [2, 3, 3, 1, 1, 1, 2],
]

const CODE_START_B = 104
const CODE_STOP = 106

/** Modules of quiet zone (blank border) a Code 128 barcode needs on each
 * side to be readable — the spec calls for roughly 10x the narrow-bar
 * width, much more than a QR code's margin. */
export const CODE128_QUIET_ZONE_MODULES = 10

/**
 * A 1D bar pattern, exposed the same shape as `QrMatrix` from `qrRender.ts`
 * (width + a per-position dark test) so callers can treat both symbologies
 * uniformly. `width` excludes quiet zone.
 */
export interface Code128Bars {
  width: number
  isDark(x: number): boolean
}

/**
 * Renders `value` as a Code 128 (Code Set B) bar pattern. Returns `null` for
 * an empty value or one containing a character outside Code Set B's range
 * (ASCII 32–126, i.e. printable ASCII) — extended characters have no
 * representation in this symbology, so the caller should fall back to
 * showing the raw text (or use a QR code instead, which has no such limit).
 */
export function encodeCode128(value: string): Code128Bars | null {
  if (!value.trim()) return null

  const symbols: number[] = []
  for (let i = 0; i < value.length; i++) {
    const charCode = value.charCodeAt(i)
    if (charCode < 32 || charCode > 126) return null
    symbols.push(charCode - 32)
  }

  let checksum = CODE_START_B
  symbols.forEach((symbol, index) => {
    checksum += symbol * (index + 1)
  })
  checksum %= 103

  const codes = [CODE_START_B, ...symbols, checksum, CODE_STOP]
  const widths = codes.flatMap((code) => CODE128_PATTERNS[code])

  const total = widths.reduce((sum, w) => sum + w, 0)
  const darkAt = new Array<boolean>(total)
  let pos = 0
  let dark = true
  for (const width of widths) {
    for (let i = 0; i < width; i++) darkAt[pos++] = dark
    dark = !dark
  }

  return { width: total, isDark: (x) => darkAt[x] ?? false }
}
