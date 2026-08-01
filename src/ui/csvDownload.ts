/** Excel only reads UTF-8 CSV correctly when it starts with a byte order mark. */
const BOM = '﻿'

/** Saves `csv` to the user's downloads folder under `filename`. */
export function downloadCsv(filename: string, csv: string, doc: Document = document): void {
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)

  const anchor = doc.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  doc.body.appendChild(anchor)
  anchor.click()
  anchor.remove()

  URL.revokeObjectURL(url)
}

/** `products-2026-08-01.csv` — stable, sortable and safe on every filesystem. */
export function timestampedFilename(prefix: string, at: Date = new Date()): string {
  return `${prefix}-${at.toISOString().slice(0, 10)}.csv`
}
