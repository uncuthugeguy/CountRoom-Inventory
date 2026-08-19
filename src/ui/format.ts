export const formatNumber = (value: number): string => value.toLocaleString()

/** `+7` / `-4` — the sign carries the meaning in the history list. */
export const formatDelta = (delta: number): string =>
  delta > 0 ? `+${delta}` : String(delta)

export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** "2h ago" style relative timestamp, used by the activity log so a recent
 * change is glanceable without doing date arithmetic in your head. Falls
 * back to the full date/time (via `formatDateTime`) once something is a
 * week or more old, where "N days ago" stops being more useful than the
 * actual date. A negative gap (clock skew, or a stamp from the future) is
 * treated as "just now" rather than showing a nonsensical negative value. */
export function formatRelativeTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso

  const diffSeconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000))
  if (diffSeconds < 5) return 'just now'
  if (diffSeconds < 60) return `${diffSeconds}s ago`

  const diffMinutes = Math.round(diffSeconds / 60)
  if (diffMinutes < 60) return `${diffMinutes}m ago`

  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.round(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`

  return formatDateTime(iso)
}

/** Plain 2dp numeric formatting for money amounts — matches the `.toFixed(2)`
 * convention used at checkout and elsewhere in the app (no currency symbol,
 * since StockFlow doesn't assume one). */
export const formatCurrency = (value: number): string => value.toFixed(2)

/** A percentage value that's already scaled 0-100 (e.g. profit margin) — the
 * caller appends its own `%` sign so this stays reusable in sentences. */
export const formatPercent = (value: number): string => value.toFixed(1)
