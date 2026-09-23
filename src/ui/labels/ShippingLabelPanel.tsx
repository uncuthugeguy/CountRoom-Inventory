import { useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { printShippingLabel } from '../../printing/labelJobs'
import {
  autoCrop,
  initialCrop,
  composeShippingLabel,
  openShippingSource,
  previewScaleFor,
  type CropRect,
  type ShippingRotation,
  type ShippingSource,
} from '../../printing/shippingLabel'
import type { SettingsApi } from '../useSettings'
import { DraggableBox } from './DraggableBox'

interface PagePreview {
  url: string
  width: number
  height: number
  scale: number
}

const ROTATION_OPTIONS: { value: string; label: string }[] = [
  { value: 'auto', label: 'Automatic' },
  { value: '0', label: 'None' },
  { value: '90', label: '90° clockwise' },
  { value: '180', label: '180°' },
  { value: '270', label: '90° anticlockwise' },
]

/**
 * 4 × 6 in shipping labels: drop in the PDF (or a screenshot) from eBay,
 * Royal Mail Click & Drop, Evri etc. The label is found automatically; drag
 * the box to adjust what's included, then print.
 */
export function ShippingLabelPanel({ settings }: { settings: SettingsApi }) {
  const id = useId()
  const [source, setSource] = useState<ShippingSource | null>(null)
  const [pageIndex, setPageIndex] = useState(0)
  const [page, setPage] = useState<PagePreview | null>(null)
  const [crop, setCrop] = useState<CropRect | null>(null)
  const [autoRect, setAutoRect] = useState<CropRect | null>(null)
  const [rotation, setRotation] = useState<ShippingRotation>('auto')
  const [output, setOutput] = useState<HTMLCanvasElement | null>(null)
  const [outputUrl, setOutputUrl] = useState('')
  const [copies, setCopies] = useState(1)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const pageCanvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => () => source?.close(), [source])

  const loadFile = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setStatus(null)
    setBusy('Reading the label…')
    try {
      const next = await openShippingSource(file)
      setSource(next) // the effect cleanup above closes the previous file
      setPageIndex(0)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(null)
    }
  }

  // Render the chosen page for the preview and find the label on it.
  useEffect(() => {
    if (!source) return
    let cancelled = false
    setBusy('Finding the label…')
    void (async () => {
      try {
        const scale = await previewScaleFor(source, pageIndex)
        const canvas = await source.renderPage(pageIndex, scale)
        if (cancelled) return
        pageCanvasRef.current = canvas
        setPage({ url: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height, scale })
        setAutoRect(autoCrop(canvas))
        setCrop(initialCrop(canvas))
        setError(null)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (!cancelled) setBusy(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [source, pageIndex])

  // Build the real 4 × 6 output whenever the crop/rotation settle.
  useEffect(() => {
    if (!source || !page || !crop) return
    let cancelled = false
    const timer = setTimeout(() => {
      void composeShippingLabel(source, pageIndex, page.scale, crop, rotation)
        .then((canvas) => {
          if (cancelled) return
          setOutput(canvas)
          setOutputUrl(canvas.toDataURL('image/png'))
        })
        .catch((cause) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [source, page, pageIndex, crop, rotation])

  const print = async () => {
    if (!output) return
    setBusy('Printing…')
    const result = await printShippingLabel(output, settings, copies)
    setStatus(result.ok ? 'Shipping label sent to the printer.' : `Print failed: ${result.error}`)
    setBusy(null)
  }

  const clear = () => {
    setSource(null)
    setPage(null)
    setCrop(null)
    setOutput(null)
    setOutputUrl('')
    setStatus(null)
    setError(null)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragOver(false)
    void loadFile(event.dataTransfer.files?.[0])
  }

  return (
    <section className="panel">
      <h2>Shipping label (4 × 6 in)</h2>
      <p className="muted">
        Download the label from eBay, Royal Mail Click &amp; Drop, Evri or any courier as a PDF (or take a
        screenshot) and drop it here. The label is picked out of the page automatically — including from an A4
        sheet — and sized to fill a 4 × 6 label.
      </p>

      {!source && (
        <div
          className={`drop-zone ${dragOver ? 'drop-zone-active' : ''}`}
          onDragOver={(event) => {
            event.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <label htmlFor={`${id}-file`} className="button button-primary">
            Choose label PDF or image
          </label>
          <input
            id={`${id}-file`}
            className="visually-hidden"
            type="file"
            accept="application/pdf,.pdf,image/png,image/jpeg,image/webp"
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              void loadFile(file)
            }}
          />
          <span className="hint">…or drag it onto this box.</span>
        </div>
      )}

      {busy && (
        <p className="muted" role="status">
          {busy}
        </p>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      {source && page && crop && (
        <div className="shipping-layout">
          <div className="shipping-source">
            <span className="label-like">
              {source.fileName}
              {source.pageCount > 1 ? ` — page ${pageIndex + 1} of ${source.pageCount}` : ''}
            </span>
            <div
              ref={stageRef}
              className="label-stage shipping-stage"
              style={{ aspectRatio: `${page.width} / ${page.height}` }}
            >
              <img src={page.url} alt="Uploaded page" draggable={false} />
              <DraggableBox
                box={crop}
                bounds={{ w: page.width, h: page.height }}
                stageRef={stageRef}
                label="Printed area"
                selected
                minSize={20}
                className="crop-box"
                onChange={(box) => setCrop(box)}
              />
            </div>
            <span className="hint">Drag the box or its corners to change exactly what's printed.</span>
          </div>

          <div className="shipping-controls">
            <span className="label-like">What prints (4 × 6)</span>
            <div className="shipping-output">
              {outputUrl ? <img src={outputUrl} alt="4 by 6 label preview" /> : <span className="hint">Preparing…</span>}
            </div>

            {source.pageCount > 1 && (
              <div className="field">
                <label htmlFor={`${id}-page`}>Page</label>
                <select id={`${id}-page`} value={pageIndex} onChange={(e) => setPageIndex(Number(e.target.value))}>
                  {Array.from({ length: source.pageCount }, (_, i) => (
                    <option key={i} value={i}>
                      Page {i + 1}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="field">
              <label htmlFor={`${id}-rotation`}>Rotate</label>
              <select
                id={`${id}-rotation`}
                value={String(rotation)}
                onChange={(e) =>
                  setRotation(e.target.value === 'auto' ? 'auto' : (Number(e.target.value) as ShippingRotation))
                }
              >
                {ROTATION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="checkbox-field-row">
              <button type="button" className="button" onClick={() => autoRect && setCrop(autoRect)}>
                Auto-find label
              </button>
              <button type="button" className="button" onClick={() => setCrop({ x: 0, y: 0, w: page.width, h: page.height })}>
                Whole page
              </button>
            </div>

            <div className="label-actions">
              <div className="field label-copies">
                <label htmlFor={`${id}-copies`}>Copies</label>
                <input
                  id={`${id}-copies`}
                  type="number"
                  min={1}
                  max={50}
                  value={copies}
                  onChange={(e) => setCopies(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                />
              </div>
              <button type="button" className="button button-primary" onClick={print} disabled={!output || !!busy}>
                Print shipping label
              </button>
              <button type="button" className="button button-ghost" onClick={clear}>
                Start again
              </button>
            </div>
            {status && (
              <p className="muted" role="status">
                {status}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
