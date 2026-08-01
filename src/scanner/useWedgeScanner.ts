import { useEffect, useRef } from 'react'
import { createWedgeBuffer } from './wedgeBuffer'

/** Fields where the user is deliberately typing; wedge capture stays off. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return false || target.isContentEditable
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export interface WedgeScannerOptions {
  enabled?: boolean
  minLength?: number
  interKeyMs?: number
}

/**
 * Listens for a USB/Bluetooth HID barcode scanner in keyboard-wedge mode: a
 * fast burst of keystrokes terminated by Enter. Keystrokes aimed at a form
 * field are left alone so normal typing still works.
 */
export function useWedgeScanner(
  onScan: (barcode: string) => void,
  { enabled = true, minLength = 4, interKeyMs = 50 }: WedgeScannerOptions = {},
): void {
  const handler = useRef(onScan)
  handler.current = onScan

  useEffect(() => {
    if (!enabled) return

    const buffer = createWedgeBuffer({ minLength, interKeyMs })

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target)) return

      const scanned = buffer.push(event.key, event.timeStamp)
      if (event.key === 'Enter') event.preventDefault()
      if (scanned) handler.current(scanned)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, minLength, interKeyMs])
}
