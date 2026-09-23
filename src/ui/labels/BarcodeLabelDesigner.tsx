import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from 'react'
import type { Product } from '../../domain/types'
import {
  DEFAULT_BARCODE_LABEL_LAYOUT,
  LABEL_ELEMENT_KEYS,
  LABEL_ELEMENT_NAMES,
  MAX_FONT_DOTS,
  MIN_FONT_DOTS,
  clampBox,
  isTextElementKey,
  type BarcodeLabelLayout,
  type LabelBox,
  type LabelElementKey,
  type TextAlign,
  type TextElement,
} from '../../printing/barcodeLabelLayout'
import type { LabelContent, LabelWarning } from '../../printing/barcodeLabelPlan'
import { contentForProduct, printProductLabel, renderBarcodeLabel } from '../../printing/labelJobs'
import { LABEL_MEDIA, dotsToMm, dotsToPt, mmToDots, ptToDots } from '../../printing/labelMedia'
import type { SettingsApi } from '../useSettings'
import { DraggableBox, type Box } from './DraggableBox'
import { LogoPanel } from './LogoPanel'

const MEDIA = LABEL_MEDIA['2x1']
const BOUNDS = { w: MEDIA.widthDots, h: MEDIA.heightDots }
/** Pull a box onto the label's centre line when it's dragged within this many dots of it. */
const SNAP_DOTS = 5

const SAMPLE: LabelContent = { name: 'Sample Product Name', sku: 'SKU-018', variation: 'Large / Blue', price: 12.99 }

const round1 = (n: number) => Math.round(n * 10) / 10

export interface BarcodeLabelDesignerProps {
  settings: SettingsApi
  products: Product[]
}

/**
 * Settings for the 2 × 1 in barcode label: drag and resize each element on
 * a preview that *is* the exact bitmap sent to the Polono (rendered at
 * 203 dpi, black and white), so there's no "looks fine on screen, prints
 * differently" gap.
 */
export function BarcodeLabelDesigner({ settings, products }: BarcodeLabelDesignerProps) {
  const id = useId()
  const saved = settings.barcodeLabelLayout ?? DEFAULT_BARCODE_LABEL_LAYOUT
  // Local draft so dragging is smooth; saved to settings when a drag ends.
  const [layout, setLayout] = useState<BarcodeLabelLayout>(saved)
  const [selected, setSelected] = useState<LabelElementKey>('name')
  const [previewProductId, setPreviewProductId] = useState<string>('')
  const [previewUrl, setPreviewUrl] = useState<string>('')
  const [warnings, setWarnings] = useState<LabelWarning[]>([])
  const [renderError, setRenderError] = useState<string | null>(null)
  const [copies, setCopies] = useState(1)
  const [status, setStatus] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)

  // Pick up a layout synced in from another device.
  useEffect(() => setLayout(saved), [saved])

  const previewProduct = products.find((p) => p.id === previewProductId)
  const content = useMemo(() => (previewProduct ? contentForProduct(previewProduct) : SAMPLE), [previewProduct])

  useEffect(() => {
    let cancelled = false
    renderBarcodeLabel(layout, content, settings.logoDataUrl)
      .then(({ canvas, warnings: w }) => {
        if (cancelled) return
        setPreviewUrl(canvas.toDataURL('image/png'))
        setWarnings(w)
        setRenderError(null)
      })
      .catch((cause) => {
        if (!cancelled) setRenderError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      cancelled = true
    }
  }, [layout, content, settings.logoDataUrl])

  const commit = (next: BarcodeLabelLayout) => {
    setLayout(next)
    settings.setBarcodeLabelLayout(next)
  }

  const patchElement = (key: LabelElementKey, patch: Partial<TextElement>, final = true) => {
    const next = { ...layout, [key]: { ...layout[key], ...patch } } as BarcodeLabelLayout
    if (final) commit(next)
    else setLayout(next)
  }

  const setBox = (key: LabelElementKey, box: Box, final: boolean) => patchElement(key, clampBox(box), final)

  const snapToCentre = (box: Box, mode: string): Box => {
    if (mode !== 'move') return box
    const centre = box.x + box.w / 2
    return Math.abs(centre - BOUNDS.w / 2) <= SNAP_DOTS ? { ...box, x: Math.round(BOUNDS.w / 2 - box.w / 2) } : box
  }

  const el = layout[selected]
  const textEl = isTextElementKey(selected) ? layout[selected] : null

  const mmField = (field: keyof LabelBox, label: string) => (
    <div className="field" key={field}>
      <label htmlFor={`${id}-${field}`}>{label} (mm)</label>
      <input
        id={`${id}-${field}`}
        type="number"
        inputMode="decimal"
        step={0.5}
        value={round1(dotsToMm(el[field]))}
        onChange={(event) => {
          const mm = Number(event.target.value)
          if (!Number.isFinite(mm)) return
          setBox(selected, { ...pickBox(el), [field]: mmToDots(mm) }, true)
        }}
      />
    </div>
  )

  const testPrint = async () => {
    setPrinting(true)
    setStatus('Printing…')
    const result = await printProductLabel(
      previewProduct ?? { name: SAMPLE.name, sku: SAMPLE.sku, variation: SAMPLE.variation ?? '', price: SAMPLE.price ?? 0 },
      { ...settings, barcodeLabelLayout: layout },
      copies,
    )
    setStatus(result.ok ? 'Sent to the printer.' : `Print failed: ${result.error}`)
    setPrinting(false)
  }

  return (
    <>
      <section className="panel">
        <h2>Barcode label (2 × 1 in)</h2>
        <p className="muted">
          This preview is the exact black-and-white image the Polono prints. Drag an element to move it, pull a
          corner to resize it. Text shrinks to fit its box and the barcode picks the widest bars that fit, so a
          bigger box means a bigger, easier-to-scan label. Changes save automatically.
        </p>

        <div className="field label-preview-picker">
          <label htmlFor={`${id}-product`}>Preview with</label>
          <select id={`${id}-product`} value={previewProductId} onChange={(e) => setPreviewProductId(e.target.value)}>
            <option value="">Sample product</option>
            {products
              .filter((p) => p.sku)
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.sku})
                </option>
              ))}
          </select>
        </div>

        <div className="label-designer">
          <div className="label-stage-wrap">
            <div ref={stageRef} className="label-stage label-stage-2x1">
              {previewUrl && <img src={previewUrl} alt="Label preview" draggable={false} />}
              {LABEL_ELEMENT_KEYS.filter((key) => layout[key].visible).map((key) => (
                <DraggableBox
                  key={key}
                  box={pickBox(layout[key])}
                  bounds={BOUNDS}
                  stageRef={stageRef}
                  label={LABEL_ELEMENT_NAMES[key]}
                  selected={selected === key}
                  snap={snapToCentre}
                  onSelect={() => setSelected(key)}
                  onChange={(box, final) => setBox(key, box, final)}
                />
              ))}
            </div>
            <p className="hint">
              Actual size: 51 × 25 mm. Arrow keys nudge the selected element (Shift for bigger steps, Alt/Option to
              resize).
            </p>
            {renderError && (
              <p className="alert" role="alert">
                {renderError}
              </p>
            )}
            {warnings.length > 0 && (
              <ul className="label-warnings" aria-label="Label warnings">
                {warnings.map((w) => (
                  <li key={`${w.key}-${w.message}`}>{w.message}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="label-inspector">
            <div className="field">
              <span className="label-like">On the label</span>
              <div className="checkbox-field-row">
                {LABEL_ELEMENT_KEYS.map((key) => (
                  <label key={key} className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={layout[key].visible}
                      onChange={(e) => {
                        patchElement(key, { visible: e.target.checked })
                        if (e.target.checked) setSelected(key)
                      }}
                    />
                    {LABEL_ELEMENT_NAMES[key]}
                  </label>
                ))}
              </div>
              {layout.logo.visible && !settings.logoDataUrl && (
                <span className="hint">Upload a logo below for it to appear.</span>
              )}
            </div>

            <div className="field">
              <label htmlFor={`${id}-selected`}>Editing</label>
              <select
                id={`${id}-selected`}
                value={selected}
                onChange={(e) => setSelected(e.target.value as LabelElementKey)}
              >
                {LABEL_ELEMENT_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {LABEL_ELEMENT_NAMES[key]}
                    {layout[key].visible ? '' : ' (hidden)'}
                  </option>
                ))}
              </select>
            </div>

            <div className="label-inspector-grid">
              {mmField('x', 'Left')}
              {mmField('y', 'Top')}
              {mmField('w', 'Width')}
              {mmField('h', 'Height')}
            </div>

            {textEl && (
              <div className="label-inspector-grid">
                <div className="field">
                  <label htmlFor={`${id}-size`}>Max text size (pt)</label>
                  <input
                    id={`${id}-size`}
                    type="number"
                    inputMode="decimal"
                    step={0.5}
                    min={round1(dotsToPt(MIN_FONT_DOTS))}
                    max={round1(dotsToPt(MAX_FONT_DOTS))}
                    value={round1(dotsToPt(textEl.fontSize))}
                    onChange={(e) => {
                      const pt = Number(e.target.value)
                      if (!Number.isFinite(pt)) return
                      patchElement(selected, {
                        fontSize: Math.min(MAX_FONT_DOTS, Math.max(MIN_FONT_DOTS, ptToDots(pt))),
                      })
                    }}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`${id}-align`}>Align</label>
                  <select
                    id={`${id}-align`}
                    value={textEl.align}
                    onChange={(e) => patchElement(selected, { align: e.target.value as TextAlign })}
                  >
                    <option value="left">Left</option>
                    <option value="center">Centre</option>
                    <option value="right">Right</option>
                  </select>
                </div>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={textEl.bold}
                    onChange={(e) => patchElement(selected, { bold: e.target.checked })}
                  />
                  Bold
                </label>
              </div>
            )}
          </div>
        </div>

        <div className="label-actions">
          <div className="field label-copies">
            <label htmlFor={`${id}-copies`}>Copies</label>
            <input
              id={`${id}-copies`}
              type="number"
              min={1}
              max={500}
              value={copies}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setCopies(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
            />
          </div>
          <button type="button" className="button button-primary" onClick={testPrint} disabled={printing}>
            {previewProduct ? `Print ${previewProduct.name}` : 'Print test label'}
          </button>
          <button
            type="button"
            className="button button-ghost"
            onClick={() => {
              settings.resetBarcodeLabelLayout()
              setLayout(DEFAULT_BARCODE_LABEL_LAYOUT)
              setSelected('name')
            }}
          >
            Reset layout
          </button>
        </div>
        {status && (
          <p className="muted" role="status">
            {status}
          </p>
        )}
      </section>

      <LogoPanel settings={settings} />
    </>
  )
}

const pickBox = (b: LabelBox): Box => ({ x: b.x, y: b.y, w: b.w, h: b.h })
