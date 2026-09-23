import { useEffect, useId, useState } from 'react'
import { printAlignmentTest } from '../../printing/labelJobs'
import { LABEL_MEDIA, LABEL_SIZES, dotsToMm, mmToDots, type LabelSize } from '../../printing/labelMedia'
import { desktopPrinting, type LabelPrinterInfo } from '../../printing/labelPrint'
import { DEFAULT_LABEL_PRINTER_SETTINGS, MAX_OFFSET_DOTS } from '../../printing/labelPrinterSettings'
import type { LabelRotation, PrinterCalibration } from '../../printing/labelRaster'
import type { SettingsApi } from '../useSettings'

const looksLikePolono = (p: LabelPrinterInfo) => /polono|pl[- ]?\d{2,3}/i.test(`${p.name} ${p.displayName}`)
const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Per-device printer settings: which printer (desktop app), and a nudge /
 * rotation for each label size so the print lines up with the label.
 */
export function PrinterSetupPanel({ settings }: { settings: SettingsApi }) {
  const id = useId()
  const printer = settings.labelPrinter ?? DEFAULT_LABEL_PRINTER_SETTINGS
  const bridge = desktopPrinting()
  const [printers, setPrinters] = useState<LabelPrinterInfo[] | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    if (!bridge) return
    let cancelled = false
    bridge
      .listPrinters()
      .then((list) => {
        if (!cancelled) setPrinters(list)
      })
      .catch(() => {
        if (!cancelled) setPrinters([])
      })
    return () => {
      cancelled = true
    }
  }, [bridge])

  const setCalibration = (size: LabelSize, patch: Partial<PrinterCalibration>) =>
    settings.setLabelPrinter({
      ...printer,
      calibration: { ...printer.calibration, [size]: { ...printer.calibration[size], ...patch } },
    })

  const test = async (size: LabelSize) => {
    setStatus(`Printing ${LABEL_MEDIA[size].label} alignment test…`)
    const result = await printAlignmentTest(size, settings)
    setStatus(result.ok ? 'Alignment test sent to the printer.' : `Print failed: ${result.error}`)
  }

  return (
    <section className="panel">
      <h2>Printer setup</h2>

      {bridge ? (
        <div className="field">
          <label htmlFor={`${id}-printer`}>Polono printer</label>
          <select
            id={`${id}-printer`}
            value={printer.printerName ?? ''}
            onChange={(e) => {
              const { printerName: _drop, ...rest } = printer
              settings.setLabelPrinter(e.target.value ? { ...rest, printerName: e.target.value } : rest)
            }}
          >
            <option value="">Ask every time (show the print dialog)</option>
            {(printers ?? []).map((p) => (
              <option key={p.name} value={p.name}>
                {p.displayName}
                {looksLikePolono(p) ? ' — Polono' : ''}
              </option>
            ))}
            {printer.printerName && printers && !printers.some((p) => p.name === printer.printerName) && (
              <option value={printer.printerName}>{printer.printerName} (not connected)</option>
            )}
          </select>
          <span className="hint">
            Pick the Polono to print labels straight away with no dialog, at exactly the right size. If it isn't
            listed, install the Polono driver and add it in your computer's printer settings first.
          </span>
        </div>
      ) : (
        <div className="printer-help">
          <p className="muted">
            In a web browser, labels print through the normal print dialog. The first time, choose:
          </p>
          <ol className="muted">
            <li>Printer: your Polono</li>
            <li>Paper size: the label you're printing (2 × 1 in or 4 × 6 in)</li>
            <li>Margins: None — Scale: 100% (not “Fit to page”)</li>
          </ol>
          <p className="muted">
            Your browser remembers these. The CountRoom desktop app can print with no dialog at all.
          </p>
        </div>
      )}

      <div className="calibration-grid">
        {LABEL_SIZES.map((size) => {
          const cal = printer.calibration[size]
          return (
            <fieldset key={size} className="calibration-card">
              <legend>{LABEL_MEDIA[size].label}</legend>
              <div className="label-inspector-grid">
                <div className="field">
                  <label htmlFor={`${id}-${size}-x`}>Shift right (mm)</label>
                  <input
                    id={`${id}-${size}-x`}
                    type="number"
                    step={0.25}
                    min={round2(-dotsToMm(MAX_OFFSET_DOTS))}
                    max={round2(dotsToMm(MAX_OFFSET_DOTS))}
                    value={round2(dotsToMm(cal.offsetX))}
                    onChange={(e) => setCalibration(size, { offsetX: mmToDots(Number(e.target.value) || 0) })}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`${id}-${size}-y`}>Shift down (mm)</label>
                  <input
                    id={`${id}-${size}-y`}
                    type="number"
                    step={0.25}
                    min={round2(-dotsToMm(MAX_OFFSET_DOTS))}
                    max={round2(dotsToMm(MAX_OFFSET_DOTS))}
                    value={round2(dotsToMm(cal.offsetY))}
                    onChange={(e) => setCalibration(size, { offsetY: mmToDots(Number(e.target.value) || 0) })}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`${id}-${size}-rot`}>Rotate print</label>
                  <select
                    id={`${id}-${size}-rot`}
                    value={cal.rotation}
                    onChange={(e) => setCalibration(size, { rotation: Number(e.target.value) as LabelRotation })}
                  >
                    <option value={0}>None</option>
                    <option value={90}>90°</option>
                    <option value={180}>180°</option>
                    <option value={270}>270°</option>
                  </select>
                </div>
              </div>
              <button type="button" className="button" onClick={() => void test(size)}>
                Print alignment test
              </button>
            </fieldset>
          )
        })}
      </div>
      <p className="hint">
        The alignment test prints a box 1 mm inside the label edges. If it's off-centre, shift it; if it comes out
        sideways or upside-down, rotate it. Leave everything at 0 if it already lines up.
      </p>
      {status && (
        <p className="muted" role="status">
          {status}
        </p>
      )}
    </section>
  )
}
