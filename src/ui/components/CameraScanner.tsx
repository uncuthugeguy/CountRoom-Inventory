import { useEffect, useRef, useState } from 'react'
import {
  startCameraScan as defaultStart,
  type CameraControls,
  type StartCameraScan,
} from '../../scanner/cameraScanner'

export interface CameraScannerProps {
  onDecode: (text: string) => void
  /** Injected in tests; defaults to the zxing-backed implementation. */
  start?: StartCameraScan
}

/**
 * Camera barcode scanning. The stream is only opened once the user asks for
 * it, and is always released when the preview goes away.
 */
export function CameraScanner({ onDecode, start = defaultStart }: CameraScannerProps) {
  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const decode = useRef(onDecode)
  decode.current = onDecode

  useEffect(() => {
    if (!active) return

    let controls: CameraControls | null = null
    let stopped = false

    void (async () => {
      const element = video.current
      if (!element) return
      try {
        const started = await start(element, (text) => decode.current(text))
        if (stopped) {
          started.stop()
          return
        }
        controls = started
      } catch (cause) {
        if (stopped) return
        setError(cause instanceof Error ? cause.message : String(cause))
        setActive(false)
      }
    })()

    return () => {
      stopped = true
      controls?.stop()
    }
  }, [active, start])

  const toggle = () => {
    setError(null)
    setActive((on) => !on)
  }

  return (
    <div className="camera">
      <div className="camera-controls">
        <button type="button" className="button" onClick={toggle}>
          {active ? 'Stop camera' : 'Start camera'}
        </button>
        {active && <span className="camera-hint">Hold the barcode inside the frame.</span>}
      </div>

      {active && (
        <div className="camera-preview">
          <video ref={video} muted playsInline autoPlay aria-label="Camera preview" />
          <div className="camera-reticle" aria-hidden="true" />
        </div>
      )}

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
