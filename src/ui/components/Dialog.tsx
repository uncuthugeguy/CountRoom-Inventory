import { useEffect, useId, useRef, type ReactNode } from 'react'

export interface DialogProps {
  title: string
  onClose: () => void
  children: ReactNode
}

/**
 * A modal panel. The native <dialog> element is avoided so the same markup
 * works in every target browser and under test.
 */
export function Dialog({ title, onClose, children }: DialogProps) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    // Land the caret in the first field so a scan or a keyboard entry works
    // immediately, without a tap on a phone.
    const first = panel.current?.querySelector<HTMLElement>('input, select, textarea, button')
    first?.focus()
  }, [])

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panel}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}
