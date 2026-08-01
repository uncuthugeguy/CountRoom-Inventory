export interface WedgeBufferOptions {
  /**
   * Maximum gap between keystrokes, in milliseconds, for input to count as a
   * scanner burst. HID scanners emit a whole barcode in a few milliseconds per
   * character; a person typing is far slower.
   */
  interKeyMs?: number
  /**
   * Shortest credible scan; anything shorter is discarded. The default only
   * filters stray Enter presses — callers wanting real barcodes raise it.
   */
  minLength?: number
}

export interface WedgeBuffer {
  /** Feeds one key. Returns the barcode when a scan completes, else null. */
  push(key: string, at: number): string | null
  reset(): void
}

export function createWedgeBuffer({
  interKeyMs = 50,
  minLength = 2,
}: WedgeBufferOptions = {}): WedgeBuffer {
  let chars: string[] = []
  let lastAt = 0

  const reset = () => {
    chars = []
  }

  return {
    reset,
    push(key, at) {
      if (key === 'Enter') {
        const scanned = chars.join('')
        reset()
        return scanned.length >= minLength ? scanned : null
      }

      // Printable keys only: Shift, Tab, ArrowLeft and friends are multi-char.
      if (key.length !== 1) return null

      if (chars.length > 0 && at - lastAt > interKeyMs) reset()
      chars.push(key)
      lastAt = at
      return null
    },
  }
}
