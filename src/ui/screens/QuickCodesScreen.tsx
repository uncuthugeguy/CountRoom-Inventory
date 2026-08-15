import { useId, useMemo, useState, type FormEvent } from 'react'
import { DEFAULT_QUICK_CODE_CATEGORIES, matchesQuickCodeSearch, type QuickCode, type QuickCodeDraft } from '../../domain/quickCodes'
import type { SettingsApi } from '../useSettings'
import { Dialog } from '../components/Dialog'
import { ScanCode } from '../components/ScanCode'
import { CameraScanner } from '../components/CameraScanner'
import type { StartCameraScan } from '../../scanner/cameraScanner'

export interface QuickCodesScreenProps {
  settings: SettingsApi
  /** Injected in tests; the form otherwise uses the real camera. */
  startCamera?: StartCameraScan
}

const EMPTY_DRAFT: QuickCodeDraft = { category: DEFAULT_QUICK_CODE_CATEGORIES[0], name: '', value: '', format: 'qr' }

/** Used for both adding a new code and editing an existing one — same
 * fields either way, just a different submit handler and starting values. */
function QuickCodeForm({
  idPrefix,
  initial,
  categories,
  onSubmit,
  onCancel,
  submitLabel,
  startCamera,
}: {
  idPrefix: string
  initial: QuickCodeDraft
  categories: string[]
  onSubmit: (draft: QuickCodeDraft) => void
  onCancel: () => void
  submitLabel: string
  startCamera?: StartCameraScan
}) {
  const [category, setCategory] = useState(initial.category)
  const [name, setName] = useState(initial.name)
  const [value, setValue] = useState(initial.value)
  const [note, setNote] = useState(initial.note ?? '')
  const [format, setFormat] = useState<QuickCode['format']>(initial.format)
  const [showCamera, setShowCamera] = useState(false)
  const datalistId = `${idPrefix}-categories`

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmedName = name.trim()
    const trimmedValue = value.trim()
    const trimmedCategory = category.trim() || 'Other'
    if (!trimmedName || !trimmedValue) return
    onSubmit({
      category: trimmedCategory,
      name: trimmedName,
      value: trimmedValue,
      ...(note.trim() ? { note: note.trim() } : {}),
      format,
    })
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="field">
        <label htmlFor={`${idPrefix}-category`}>Category</label>
        <input
          id={`${idPrefix}-category`}
          list={datalistId}
          value={category}
          autoComplete="off"
          onChange={(event) => setCategory(event.target.value)}
        />
        <datalist id={datalistId}>
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>

      <div className="field">
        <label htmlFor={`${idPrefix}-name`}>Name</label>
        <input
          id={`${idPrefix}-name`}
          value={name}
          autoComplete="off"
          placeholder="e.g. Restore defaults"
          onChange={(event) => setName(event.target.value)}
          required
        />
      </div>

      <div className="field">
        <label htmlFor={`${idPrefix}-format`}>Code type</label>
        <select
          id={`${idPrefix}-format`}
          value={format}
          onChange={(event) => setFormat(event.target.value === 'code128' ? 'code128' : 'qr')}
        >
          <option value="qr">QR code</option>
          <option value="code128">Code 128 barcode</option>
        </select>
        <span className="hint">
          Most printer manuals and Wi-Fi cards use QR. Older Zebra config codes are usually printed as Code 128
          instead — pick that if the QR version won't scan back in.
        </span>
      </div>

      <div className="field">
        <label htmlFor={`${idPrefix}-value`}>Code value</label>
        <div className="toolbar-actions">
          <button type="button" className="button button-ghost" onClick={() => setShowCamera((on) => !on)}>
            {showCamera ? 'Hide camera' : 'Scan with camera'}
          </button>
        </div>
        {showCamera && (
          <CameraScanner
            start={startCamera}
            onDecode={(text) => {
              setValue(text)
              setShowCamera(false)
            }}
          />
        )}
        <textarea
          id={`${idPrefix}-value`}
          value={value}
          rows={3}
          placeholder="The decoded text from scanning the code"
          onChange={(event) => setValue(event.target.value)}
          required
        />
        <span className="hint">
          Point the camera at the printed code above, or paste the decoded text here if you already scanned it with
          another app — either way, a fresh, scannable code is generated from this text, not a picture of the
          original.
        </span>
      </div>

      <div className="field">
        <label htmlFor={`${idPrefix}-note`}>Note (optional)</label>
        <input
          id={`${idPrefix}-note`}
          value={note}
          autoComplete="off"
          placeholder="e.g. Hold the printer's feed button for 3s after scanning"
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      <div className="dialog-actions">
        <button type="button" className="button button-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button button-primary">
          {submitLabel}
        </button>
      </div>
    </form>
  )
}

export function QuickCodesScreen({ settings, startCamera }: QuickCodesScreenProps) {
  const idPrefix = useId()
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<QuickCode | null>(null)
  const [scanning, setScanning] = useState<QuickCode | null>(null)
  const [copied, setCopied] = useState(false)

  const categories = useMemo(() => {
    const fromCodes = settings.quickCodes.map((c) => c.category)
    const all = new Set([...DEFAULT_QUICK_CODE_CATEGORIES, ...fromCodes])
    return Array.from(all)
  }, [settings.quickCodes])

  const filtered = useMemo(
    () => settings.quickCodes.filter((c) => matchesQuickCodeSearch(c, search)),
    [settings.quickCodes, search],
  )

  const grouped = useMemo(() => {
    const map = new Map<string, QuickCode[]>()
    for (const category of categories) {
      const codes = filtered.filter((c) => c.category === category)
      if (codes.length > 0) map.set(category, codes)
    }
    return map
  }, [categories, filtered])

  const copyValue = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be denied by the browser — the value is still
      // visible on screen either way, so this is a nice-to-have, not fatal.
    }
  }

  return (
    <div className="screen">
      <section className="panel">
        <h2>Quick codes</h2>
        <p className="muted">
          Printer maintenance codes, Wi-Fi joins, supplier links — anything you'd otherwise dig out of a paper
          manual. Save it once, then show it on screen to scan instead.
        </p>

        <div className="field">
          <label htmlFor={`${idPrefix}-search`}>Search</label>
          <input
            id={`${idPrefix}-search`}
            type="search"
            value={search}
            autoComplete="off"
            placeholder="Search by name, category or note…"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        {settings.quickCodes.length === 0 ? (
          <p className="empty">No codes saved yet — add one below.</p>
        ) : grouped.size === 0 ? (
          <p className="empty">No codes match "{search}".</p>
        ) : (
          Array.from(grouped.entries()).map(([category, codes]) => (
            <section key={category} className="quick-code-group">
              <h3>
                {category} <span className="muted">({codes.length})</span>
              </h3>
              <ul className="plain-list channel-list">
                {codes.map((code) => (
                  <li key={code.id} className="channel-row quick-code-row">
                    <div className="quick-code-info">
                      <strong>{code.name}</strong>
                      {code.note && <span className="muted"> — {code.note}</span>}
                    </div>
                    <div className="toolbar-actions">
                      <button type="button" className="button button-primary" onClick={() => setScanning(code)}>
                        Scan
                      </button>
                      <button type="button" className="button button-ghost" onClick={() => setEditing(code)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="button button-ghost"
                        aria-label={`Delete ${code.name}`}
                        onClick={() => settings.deleteQuickCode(code.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}

        <div className="dialog-actions">
          <button type="button" className="button button-primary" onClick={() => setAdding(true)}>
            Add a code
          </button>
        </div>
      </section>

      {adding && (
        <Dialog title="Add a code" onClose={() => setAdding(false)}>
          <QuickCodeForm
            idPrefix={`${idPrefix}-add`}
            initial={EMPTY_DRAFT}
            categories={categories}
            submitLabel="Add code"
            onCancel={() => setAdding(false)}
            startCamera={startCamera}
            onSubmit={(draft) => {
              settings.addQuickCode(draft)
              setAdding(false)
            }}
          />
        </Dialog>
      )}

      {editing && (
        <Dialog title={`Edit "${editing.name}"`} onClose={() => setEditing(null)}>
          <QuickCodeForm
            idPrefix={`${idPrefix}-edit`}
            initial={editing}
            categories={categories}
            submitLabel="Save changes"
            onCancel={() => setEditing(null)}
            startCamera={startCamera}
            onSubmit={(draft) => {
              settings.updateQuickCode(editing.id, draft)
              setEditing(null)
            }}
          />
        </Dialog>
      )}

      {scanning && (
        <Dialog title={scanning.name} onClose={() => setScanning(null)}>
          <div className="scan-code-dialog">
            <ScanCode value={scanning.value} format={scanning.format} size={260} />
            {scanning.note && <p className="muted">{scanning.note}</p>}
            <div className="dialog-actions">
              <button type="button" className="button button-ghost" onClick={() => copyValue(scanning.value)}>
                {copied ? 'Copied!' : 'Copy value'}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}
