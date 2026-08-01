export const formatNumber = (value: number): string => value.toLocaleString()

/** `+7` / `-4` — the sign carries the meaning in the history list. */
export const formatDelta = (delta: number): string =>
  delta > 0 ? `+${delta}` : String(delta)

export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
