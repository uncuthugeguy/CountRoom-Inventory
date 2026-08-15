/**
 * A saved reference code — a printer maintenance command, a Wi-Fi join code,
 * a link to a supplier's site, or anything else that's normally buried in a
 * paper manual — kept in the app so it can be shown on screen and scanned
 * directly, instead of hunting through a booklet every time.
 *
 * The physical code itself isn't stored as an image; only the underlying
 * text/URL it encodes is (`value`), and the app re-renders that as a fresh,
 * scannable code on screen (see `printing/qrRender.ts` and `printing/code128Render.ts`). That's what makes
 * these safe to sync, search and edit like any other saved text.
 */
export interface QuickCode {
  id: string
  /** Free text, not a fixed enum — `DEFAULT_QUICK_CODE_CATEGORIES` are just
   * starting suggestions in the UI, not the full set. */
  category: string
  /** What this code does, e.g. "Restore defaults", "Guest Wi-Fi". */
  name: string
  /** The decoded text/URL the physical code represents — this is what gets
   * re-encoded and rendered on screen for scanning. */
  value: string
  /** Optional extra context, e.g. "Hold for 3s after scanning". */
  note?: string
  /** Which symbology to render `value` as. Defaults to 'qr' — most printer
   * manuals and Wi-Fi cards use QR, but some older Zebra config codes are
   * printed as Code 128 barcodes instead. */
  format: 'qr' | 'code128'
}

export type QuickCodeDraft = Omit<QuickCode, 'id'>

/** Starting suggestions offered in the category field — not an exhaustive or
 * enforced list; any text is a valid category. */
export const DEFAULT_QUICK_CODE_CATEGORIES = ['Printer codes', 'Wi-Fi codes', 'Supply links', 'Other']

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'

/** Keeps a saved/synced quick code usable even if it came from an older
 * version of the app or a hand-edited sync payload — drops anything without
 * the fields that actually matter, and falls back to 'qr' for a missing or
 * unrecognised format rather than refusing to show the code at all. */
export function sanitiseQuickCodes(value: unknown): QuickCode[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(isRecord)
    .filter((v) => typeof v.id === 'string' && typeof v.name === 'string' && typeof v.value === 'string')
    .map((v) => ({
      id: v.id as string,
      category: typeof v.category === 'string' && v.category.trim() ? v.category : 'Other',
      name: v.name as string,
      value: v.value as string,
      ...(typeof v.note === 'string' && v.note ? { note: v.note } : {}),
      format: v.format === 'code128' ? 'code128' : 'qr',
    }))
}

/** Matches a code against a free-text search across every field a user
 * would plausibly search by — name first (most specific), then category,
 * note and the raw value itself. */
export function matchesQuickCodeSearch(code: QuickCode, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    code.name.toLowerCase().includes(q) ||
    code.category.toLowerCase().includes(q) ||
    (code.note ?? '').toLowerCase().includes(q) ||
    code.value.toLowerCase().includes(q)
  )
}
