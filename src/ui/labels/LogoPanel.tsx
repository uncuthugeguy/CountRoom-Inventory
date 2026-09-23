import { useId, useState, type ChangeEvent } from 'react'
import { resizeLogoForStorage } from '../logoResize'
import type { SettingsApi } from '../useSettings'

/** `localStorage` throws a DOMException whose message varies by browser but
 * always mentions the quota. */
const isQuotaError = (cause: unknown): boolean =>
  cause instanceof DOMException && (cause.name === 'QuotaExceededError' || /quota/i.test(cause.message))

/** Upload/replace/remove the logo that can be printed on barcode labels. */
export function LogoPanel({ settings }: { settings: SettingsApi }) {
  const logoId = useId()
  const [error, setError] = useState<string | null>(null)

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Choose an image file (PNG, JPG or SVG).')
      return
    }
    try {
      settings.setLogo(await resizeLogoForStorage(file))
      setError(null)
    } catch (cause) {
      setError(
        isQuotaError(cause)
          ? 'That image is still too large to store even after resizing — try a simpler image, or crop it first.'
          : cause instanceof Error
            ? cause.message
            : String(cause),
      )
    }
  }

  return (
    <section className="panel">
      <h2>Label logo</h2>
      <p className="muted">
        Optional. Tick “Logo” on the barcode label to print it. Thermal labels are black and white only, so a
        simple, high-contrast logo prints best.
      </p>
      {settings.logoDataUrl && (
        <div className="logo-preview">
          <img src={settings.logoDataUrl} alt="Uploaded logo" />
        </div>
      )}
      <div className="field">
        <label htmlFor={logoId}>{settings.logoDataUrl ? 'Replace logo' : 'Upload a logo'}</label>
        <input id={logoId} type="file" accept="image/*" onChange={onFileChange} />
      </div>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {settings.logoDataUrl && (
        <div className="dialog-actions">
          <button type="button" className="button button-ghost" onClick={() => settings.clearLogo()}>
            Remove logo
          </button>
        </div>
      )}
    </section>
  )
}
