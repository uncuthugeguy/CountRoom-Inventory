import { BrowserMultiFormatReader } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'

export const CAMERA_UNSUPPORTED =
  'This browser cannot open a camera. Use Safari or Chrome over HTTPS, or scan with a USB/Bluetooth scanner.'

export interface CameraControls {
  /** Stops decoding and releases the camera. */
  stop(): void
}

export type StartCameraScan = (
  video: HTMLVideoElement,
  onResult: (text: string) => void,
) => Promise<CameraControls>

/**
 * Retail and warehouse symbologies plus QR. Restricting the set keeps the
 * per-frame decode cheap enough to stay smooth on an iPhone.
 */
const FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_128,
  BarcodeFormat.ITF,
  BarcodeFormat.QR_CODE,
  BarcodeFormat.DATA_MATRIX,
]

const HINTS = new Map<DecodeHintType, unknown>([
  [DecodeHintType.POSSIBLE_FORMATS, FORMATS],
  [DecodeHintType.TRY_HARDER, true],
])

export function isCameraSupported(nav: Navigator = navigator): boolean {
  return typeof nav?.mediaDevices?.getUserMedia === 'function'
}

/**
 * Opens the rear camera and decodes continuously into `onResult`. The decode
 * callback fires on every frame, reporting a not-found error most of the time;
 * only real results are forwarded.
 */
export const startCameraScan: StartCameraScan = async (video, onResult) => {
  if (!isCameraSupported()) throw new Error(CAMERA_UNSUPPORTED)

  const reader = new BrowserMultiFormatReader(HINTS as Map<DecodeHintType, never>, {
    delayBetweenScanAttempts: 100,
    // Long enough that one barcode held in frame is not read over and over.
    delayBetweenScanSuccess: 1200,
  })

  const controls = await reader.decodeFromVideoDevice(undefined, video, (result) => {
    const text = result?.getText()
    if (text) onResult(text)
  })

  return { stop: () => controls.stop() }
}
