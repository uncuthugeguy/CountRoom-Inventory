import { useEffect, useId, useState } from 'react'
import { printAlignmentTest, printRulerTest } from '../../printing/labelJobs'
import { LABEL_MEDIA, LABEL_SIZES, dotsToMm, mmToDots, type LabelSize } from '../../printing/labelMedia'
import { desktopPrinting, type LabelPrinterInfo } from '../../printing/labelPrint'
import {
  DEFAULT_LABEL_PRINTER_SETTINGS,
  HEAD_WIDTH_CHOICES,
  MAX_OFFSET_DOTS,
  headWidthDots,
} from '../../printing/labelPrinterSettings'
import { labelLeftOnPage, type LabelRotation, type PrinterCalibration } from '../../printing/labelRaster'
import type { SettingsApi } from '../useSettings'

const looksLikePolono = (p: LabelPrinterInfo) => /polono|pl[- ]?\d{2,3}/i.test(`${p.name} ${p.displayName}`)
const round2 = (n: number) => Math.round(n * 100) / 100
const roundHalf = (n: number) => Math.round(n * 2) / 2

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

  const ruler = async (size: LabelSize) => {
    setStatus(`Printing a ruler on the ${LABEL_MEDIA[size].label}…`)
    const result = await printRulerTest(size, settings)
    setStatus(result.ok ? 'Ruler sent to the printer.' : `Print failed: ${result.error}`)
  }

  const headDots = headWidthDots(printer)

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
            <li>
              Paper size: as wide as the printhead — 4 × 1 in for barcode labels, 4 × 6 in for shipping labels (add
              a custom size in the dialog if it's missing)
            </li>
            <li>Margins: None — Scale: 100% (not “Fit to page”)</li>
          </ol>
          <p className="muted">
            Your browser remembers these. The CountRoom desktop app is more reliable — it sends the exact size with no dialog at all.
          </p>
        </div>
      )}

      <div className="field">
        <label htmlFor={`${id}-head`}>Printhead width</label>
        <select
          id={`${id}-head`}
          value={printer.headWidthIn}
          onChange={(e) => settings.setLabelPrinter({ ...printer, headWidthIn: Number(e.target.value) })}
        >
          {HEAD_WIDTH_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <span className="hint">
          Every label is sent to the printer this wide, with the label drawn where the roll actually sits — so a
          2 in roll in a 4 in printer doesn't get cut in half.
        </span>
      </div>

      <div className="calibration-grid">
        {LABEL_SIZES.map((size) => {
          const cal = printer.calibration[size]
          const media = LABEL_MEDIA[size]
          const sideways = cal.rotation === 90 || cal.rotation === 270
          const labelW = sideways ? media.heightDots : media.widthDots
          const effectiveLeft = labelLeftOnPage(Math.max(headDots, labelW), labelW, cal.leftDots)
          return (
            <fieldset key={size} className="calibration-card">
              <legend>{media.label}</legend>
              <ol className="muted calibration-steps">
                <li>Load this label roll and press <strong>Print ruler</strong>.</li>
                <li>
                  Read the ruler at the label's <strong>left edge</strong> — e.g. if the edge is 2 mm before the
                  “20”, that's 18.
                </li>
                <li>Type it below, then print the alignment test to check.</li>
              </ol>
              <div className="label-inspector-grid">
                <div className="field">
                  <label htmlFor={`${id}-${size}-left`}>Label left edge (mm)</label>
                  <input
                    id={`${id}-${size}-left`}
                    type="number"
                    inputMode="decimal"
                    step={0.5}
                    min={0}
                    value={cal.leftDots === null ? '' : roundHalf(dotsToMm(cal.leftDots))}
                    placeholder={`Centred (${roundHalf(dotsToMm(effectiveLeft))})`}
                    onChange={(e) =>
                      setCalibration(size, {
                        leftDots: e.target.value === '' ? null : mmToDots(Math.max(0, Number(e.target.value) || 0)),
                      })
                    }
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
              <div className="checkbox-field-row">
                <button type="button" className="button button-primary" onClick={() => void ruler(size)}>
                  Print ruler
                </button>
                <button type="button" className="button" onClick={() => void test(size)}>
                  Print alignment test
                </button>
                {cal.leftDots !== null && (
                  <button type="button" className="button button-ghost" onClick={() => setCalibration(size, { leftDots: null })}>
                    Back to centred
                  </button>
                )}
              </div>
            </fieldset>
          )
        })}
      </div>
      <p className="hint">
        The alignment test prints a box 1 mm inside the label edges. If it's still a little off, adjust the left
        edge by that many mm. If it comes out sideways or upside-down, rotate it.
      </p>
      {status && (
        <p className="muted" role="status">
          {status}
        </p>
      )}
    </section>
  )
}
