import { useRef, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'

/**
 * A rectangle laid over a label/page preview that can be dragged to move it
 * and pulled by any corner to resize it — mouse, touch or pen. Arrow keys
 * nudge it (Shift = ×10); Alt/Option + arrows resize it.
 *
 * The box lives in the preview's own units (printer dots for the label
 * designer, preview pixels for the shipping-label crop), converted from
 * screen pixels using the stage's current on-screen size — so it works at
 * any zoom or screen width.
 */

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

type Mode = 'move' | 'nw' | 'ne' | 'sw' | 'se'

export interface DraggableBoxProps {
  box: Box
  /** Size of the whole stage in the box's units. */
  bounds: { w: number; h: number }
  stageRef: RefObject<HTMLElement>
  label: string
  selected?: boolean
  minSize?: number
  /** Optional tidy-up while dragging, e.g. snapping to the centre line. */
  snap?: (box: Box, mode: Mode) => Box
  onSelect?: () => void
  /** `final` is true when the drag/keypress has finished — persist then. */
  onChange: (box: Box, final: boolean) => void
  className?: string
}

const clampBoxTo = (b: Box, bounds: { w: number; h: number }, min: number): Box => {
  const w = Math.min(bounds.w, Math.max(min, Math.round(b.w)))
  const h = Math.min(bounds.h, Math.max(min, Math.round(b.h)))
  return {
    x: Math.min(bounds.w - w, Math.max(0, Math.round(b.x))),
    y: Math.min(bounds.h - h, Math.max(0, Math.round(b.y))),
    w,
    h,
  }
}

function resize(start: Box, mode: Mode, dx: number, dy: number, bounds: { w: number; h: number }, min: number): Box {
  if (mode === 'move') return clampBoxTo({ ...start, x: start.x + dx, y: start.y + dy }, bounds, min)
  let left = start.x
  let top = start.y
  let right = start.x + start.w
  let bottom = start.y + start.h
  if (mode === 'nw' || mode === 'sw') left = Math.min(right - min, Math.max(0, left + dx))
  if (mode === 'ne' || mode === 'se') right = Math.max(left + min, Math.min(bounds.w, right + dx))
  if (mode === 'nw' || mode === 'ne') top = Math.min(bottom - min, Math.max(0, top + dy))
  if (mode === 'sw' || mode === 'se') bottom = Math.max(top + min, Math.min(bounds.h, bottom + dy))
  return { x: Math.round(left), y: Math.round(top), w: Math.round(right - left), h: Math.round(bottom - top) }
}

const pct = (value: number, of: number) => `${(value / of) * 100}%`

export function DraggableBox({
  box,
  bounds,
  stageRef,
  label,
  selected = false,
  minSize = 10,
  snap,
  onSelect,
  onChange,
  className = '',
}: DraggableBoxProps) {
  const drag = useRef<{ mode: Mode; startX: number; startY: number; start: Box; last: Box; id: number } | null>(null)

  const unitsPerPx = () => {
    const rect = stageRef.current?.getBoundingClientRect()
    return rect && rect.width > 0 ? bounds.w / rect.width : 1
  }

  const begin = (mode: Mode) => (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    onSelect?.()
    ;(event.currentTarget.closest('[data-drag-box]') as HTMLElement | null)?.setPointerCapture(event.pointerId)
    drag.current = { mode, startX: event.clientX, startY: event.clientY, start: box, last: box, id: event.pointerId }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== event.pointerId) return
    const k = unitsPerPx()
    let next = resize(d.start, d.mode, (event.clientX - d.startX) * k, (event.clientY - d.startY) * k, bounds, minSize)
    if (snap) next = clampBoxTo(snap(next, d.mode), bounds, minSize)
    d.last = next
    onChange(next, false)
  }

  const end = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== event.pointerId) return
    drag.current = null
    onChange(d.last, true)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 1
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const move = delta[event.key]
    if (!move) return
    event.preventDefault()
    const next = event.altKey
      ? clampBoxTo({ ...box, w: box.w + move[0], h: box.h + move[1] }, bounds, minSize)
      : clampBoxTo({ ...box, x: box.x + move[0], y: box.y + move[1] }, bounds, minSize)
    onChange(next, true)
  }

  return (
    <div
      data-drag-box
      role="button"
      tabIndex={0}
      aria-label={`${label} — drag to move, drag a corner to resize. Arrow keys move, Alt plus arrow keys resize.`}
      aria-pressed={selected}
      className={`drag-box ${selected ? 'drag-box-selected' : ''} ${className}`}
      style={{ left: pct(box.x, bounds.w), top: pct(box.y, bounds.h), width: pct(box.w, bounds.w), height: pct(box.h, bounds.h) }}
      onPointerDown={begin('move')}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      onFocus={onSelect}
    >
      <span className="drag-box-tag">{label}</span>
      {selected &&
        (['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
          <span key={corner} className={`drag-handle drag-handle-${corner}`} onPointerDown={begin(corner)} aria-hidden="true" />
        ))}
    </div>
  )
}
