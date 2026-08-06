import { useId, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'
import type { SettingsApi } from '../useSettings'

export interface SettingsScreenProps {
  settings: SettingsApi
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read that file.'))
    reader.readAsDataURL(file)
  })
}

const commitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
  if (event.key === 'Enter') event.currentTarget.blur()
}

function SaleChannelsPanel({ settings }: { settings: SettingsApi }) {
  const newChannelId = useId()
  const [newChannel, setNewChannel] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const name = newChannel.trim()
    if (!name) return
    settings.addChannel(name)
    setNewChannel('')
  }

  return (
    <section className="panel">
      <h2>Sale channels</h2>
      <p className="muted">
        Offered as quick picks at checkout for where a sale happened — eBay, Facebook
        Marketplace, a walk-in sale, and so on. Rename or remove any of these, or add your own.
      </p>

      {settings.saleChannels.length === 0 ? (
        <p className="empty">No channels yet — add one below.</p>
      ) : (
        <ul className="plain-list channel-list">
          {settings.saleChannels.map((name) => (
            <li key={name} className="channel-row">
              <input
                className="channel-rename-input"
                defaultValue={name}
                autoComplete="off"
                aria-label={`Rename ${name}`}
                onKeyDown={commitOnEnter}
                onBlur={(event) => {
                  const next = event.target.value.trim()
                  if (next && next !== name) settings.renameChannel(name, next)
                  else event.target.value = name
                }}
              />
              <button
                type="button"
                className="button button-ghost"
                aria-label={`Remove ${name}`}
                onClick={() => settings.removeChannel(name)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="toolbar" onSubmit={submit}>
        <div className="field field-grow">
          <label htmlFor={newChannelId}>Add a channel</label>
          <input
            id={newChannelId}
            value={newChannel}
            autoComplete="off"
            placeholder="Where else do you sell?"
            onChange={(event) => setNewChannel(event.target.value)}
          />
        </div>
        <div className="toolbar-actions">
          <button type="submit" className="button button-primary">
            Add
          </button>
        </div>
      </form>
    </section>
  )
}

export function SettingsScreen({ settings }: SettingsScreenProps) {
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
      const dataUrl = await readAsDataUrl(file)
      settings.setLogo(dataUrl)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="screen">
      <section className="panel">
        <h2>Label logo</h2>
        <p className="muted">
          Uploaded once here, then printed on every product label alongside the name, SKU
          barcode and variation.
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
            <button
              type="button"
              className="button button-ghost"
              onClick={() => settings.clearLogo()}
            >
              Remove logo
            </button>
          </div>
        )}
      </section>

      <SaleChannelsPanel settings={settings} />
    </div>
  )
}
