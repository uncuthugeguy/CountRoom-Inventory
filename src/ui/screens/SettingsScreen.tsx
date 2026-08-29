import { useEffect, useId, useMemo, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'
import type { TeamMember } from '../../data/repository'
import { knownCategories } from '../../domain/products'
import type { ProfileChangeRequest, ProfileDraft } from '../../domain/types'
import type { Inventory } from '../useInventory'
import type { SettingsApi } from '../useSettings'
import { LabelTemplateEditor } from '../components/LabelTemplateEditor'
import { resizeLogoForStorage } from '../logoResize'

export interface SettingsScreenProps {
  settings: SettingsApi
  inventory: Inventory
}

/** `localStorage` throws a DOMException whose message varies by browser but
 * always mentions the quota — recognised here so a resize that still didn't
 * fit gets an explanation instead of a raw browser error string. */
const isQuotaError = (cause: unknown): boolean =>
  cause instanceof DOMException &&
  (cause.name === 'QuotaExceededError' || /quota/i.test(cause.message))

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

/** Manager-only (gated by the caller) — the product form's category field
 * (`ProductFormDialog`) is a dropdown restricted to whatever's saved here,
 * rather than free text, so this is the only place the list can change. */
function CategoriesPanel({ settings, products }: { settings: SettingsApi; products: Inventory['products'] }) {
  const newCategoryId = useId()
  const [newCategory, setNewCategory] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const name = newCategory.trim()
    if (!name) return
    settings.addProductCategory(name)
    setNewCategory('')
  }

  // Categories already sitting on products but not yet in the managed list
  // — e.g. free text typed before this feature existed. Offered as a
  // one-click way to bring the existing catalogue's categories in, rather
  // than making Mason retype everything by hand.
  const suggestions = useMemo(() => {
    const existing = new Set(settings.productCategories.map((c) => c.toLowerCase()))
    return knownCategories(products).filter((c) => !existing.has(c.toLowerCase()))
  }, [settings.productCategories, products])

  return (
    <section className="panel">
      <h2>Product categories</h2>
      <p className="muted">
        Offered as a dropdown on the product form — everyone picks from this list instead of
        typing their own, so categories stay consistent. Only a manager can add, rename or
        remove one here.
      </p>

      {settings.productCategories.length === 0 ? (
        <p className="empty">No categories yet — add one below.</p>
      ) : (
        <ul className="plain-list channel-list">
          {settings.productCategories.map((name) => (
            <li key={name} className="channel-row">
              <input
                className="channel-rename-input"
                defaultValue={name}
                autoComplete="off"
                aria-label={`Rename ${name}`}
                onKeyDown={commitOnEnter}
                onBlur={(event) => {
                  const next = event.target.value.trim()
                  if (next && next !== name) settings.renameProductCategory(name, next)
                  else event.target.value = name
                }}
              />
              <button
                type="button"
                className="button button-ghost"
                aria-label={`Remove ${name}`}
                onClick={() => settings.removeProductCategory(name)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {suggestions.length > 0 && (
        <p className="hint">
          Already on products but not in this list yet: {suggestions.join(', ')}.{' '}
          <button
            type="button"
            className="button button-ghost"
            onClick={() => suggestions.forEach((name) => settings.addProductCategory(name))}
          >
            Add all
          </button>
        </p>
      )}

      <form className="toolbar" onSubmit={submit}>
        <div className="field field-grow">
          <label htmlFor={newCategoryId}>Add a category</label>
          <input
            id={newCategoryId}
            value={newCategory}
            autoComplete="off"
            placeholder="e.g. Hand Tools"
            onChange={(event) => setNewCategory(event.target.value)}
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

const PROFILE_FIELDS: { key: keyof ProfileDraft; label: string; type?: string }[] = [
  { key: 'fullName', label: 'Full name' },
  { key: 'birthday', label: 'Birthday', type: 'date' },
  { key: 'employeeNumber', label: 'Employee number' },
  { key: 'username', label: 'Username' },
]

/** Own subsection within the personal-details panel — changes the address
 *  used to sign in. Only offered against the Supabase backend: local
 *  (offline demo) mode has no real login to change (see `AuthScreen`'s own
 *  doc comment — magic-link sign-in only exists once real Supabase
 *  credentials are configured). */
function LoginEmailPanel({ inventory }: { inventory: Inventory }) {
  const idPrefix = useId()
  const [currentEmail, setCurrentEmail] = useState<string | null>(null)
  const [newEmail, setNewEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void inventory.getLoginEmail().then(setCurrentEmail)
    // Only ever needs to run once per mount, same as the profile load above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = newEmail.trim()
    if (!trimmed) return
    setError(null)
    setInfo(null)
    setBusy(true)
    const result = await inventory.updateLoginEmail(trimmed)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setInfo(`Check ${trimmed} for a confirmation link — your login email won't change until you click it.`)
    setNewEmail('')
  }

  return (
    <div className="settings-subsection">
      <h3>Login email</h3>
      <p className="muted">
        The address you sign in with. We'll email a confirmation link to the new address —
        nothing changes until you click it, so a typo can't lock you out.
      </p>
      <p>
        Currently: <strong>{currentEmail === null ? 'Loading…' : currentEmail || '(unknown)'}</strong>
      </p>

      <form className="toolbar" onSubmit={submit}>
        <div className="field field-grow">
          <label htmlFor={`${idPrefix}-login-email`}>New login email</label>
          <input
            id={`${idPrefix}-login-email`}
            type="email"
            autoComplete="email"
            value={newEmail}
            placeholder="new.email@example.com"
            onChange={(event) => setNewEmail(event.target.value)}
          />
        </div>
        <div className="toolbar-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? 'Sending…' : 'Send confirmation'}
          </button>
        </div>
      </form>

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {info && <p className="preview">{info}</p>}
    </div>
  )
}

function AccountSettingsPanel({ inventory }: { inventory: Inventory }) {
  const idPrefix = useId()
  const [profile, setProfile] = useState<ProfileDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void inventory.getProfile().then((p) =>
      setProfile({
        fullName: p.fullName,
        birthday: p.birthday,
        address: p.address,
        employeeNumber: p.employeeNumber,
        username: p.username,
      }),
    )
    // Only ever needs to run once per mount, same as TeamPanel's load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!profile) return
    setError(null)
    setInfo(null)
    setBusy(true)
    const result = await inventory.updateProfile(profile)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setInfo(
      result.value.status === 'pending'
        ? 'Saved — waiting for a manager to approve these changes before they take effect.'
        : 'Saved.',
    )
  }

  return (
    <section className="panel">
      <h2>Account settings</h2>
      <p className="muted">
        {inventory.role === 'manager'
          ? 'Your own name, birthday, address, employee number and username — changes save immediately.'
          : "Your own name, birthday, address, employee number and username — a manager needs to approve any change before it takes effect."}
      </p>

      {profile === null ? (
        <p className="muted" role="status">
          Loading your details…
        </p>
      ) : (
        <form className="form" onSubmit={submit}>
          <div className="field-row label-template-grid">
            {PROFILE_FIELDS.map(({ key, label, type }) => {
              const fieldId = `${idPrefix}-${key}`
              return (
                <div className="field" key={key}>
                  <label htmlFor={fieldId}>{label}</label>
                  <input
                    id={fieldId}
                    type={type ?? 'text'}
                    value={profile[key]}
                    onChange={(event) => setProfile({ ...profile, [key]: event.target.value })}
                  />
                </div>
              )
            })}
          </div>

          <div className="field">
            <label htmlFor={`${idPrefix}-address`}>Address</label>
            <input
              id={`${idPrefix}-address`}
              type="text"
              value={profile.address}
              onChange={(event) => setProfile({ ...profile, address: event.target.value })}
            />
          </div>

          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          {info && <p className="preview">{info}</p>}

          <div className="dialog-actions">
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save details'}
            </button>
          </div>
        </form>
      )}

      {inventory.backend === 'supabase' && <LoginEmailPanel inventory={inventory} />}
    </section>
  )
}

const PROPOSED_FIELD_LABELS: { key: keyof ProfileDraft; label: string }[] = [
  { key: 'fullName', label: 'Name' },
  { key: 'birthday', label: 'Birthday' },
  { key: 'address', label: 'Address' },
  { key: 'employeeNumber', label: 'Employee #' },
  { key: 'username', label: 'Username' },
]

function PendingProfileChangesPanel({ inventory }: { inventory: Inventory }) {
  const [requests, setRequests] = useState<ProfileChangeRequest[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = async () => {
    setRequests(await inventory.listPendingProfileChanges())
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const decide = async (id: string, decision: 'approve' | 'reject') => {
    setError(null)
    setBusyId(id)
    const result =
      decision === 'approve' ? await inventory.approveProfileChange(id) : await inventory.rejectProfileChange(id)
    setBusyId(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await load()
  }

  return (
    <section className="panel">
      <h2>Pending profile changes</h2>
      <p className="muted">
        An employee has asked to update their own name, birthday, address, employee number or
        username — review each before it takes effect.
      </p>

      {requests === null ? (
        <p className="muted" role="status">
          Loading…
        </p>
      ) : requests.length === 0 ? (
        <p className="empty">Nothing waiting for review right now.</p>
      ) : (
        <ul className="plain-list channel-list">
          {requests.map((request) => (
            <li key={request.id} className="channel-row" style={{ alignItems: 'flex-start' }}>
              <div>
                <div>{request.memberEmail}</div>
                <div className="muted" style={{ fontSize: '.85rem' }}>
                  {PROPOSED_FIELD_LABELS.filter(({ key }) => request.proposed[key])
                    .map(({ key, label }) => `${label}: ${request.proposed[key]}`)
                    .join(' · ') || 'No details entered.'}
                </div>
              </div>
              <div className="dialog-actions">
                <button
                  type="button"
                  className="button button-ghost"
                  disabled={busyId === request.id}
                  onClick={() => decide(request.id, 'reject')}
                >
                  Reject
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  disabled={busyId === request.id}
                  onClick={() => decide(request.id, 'approve')}
                >
                  Approve
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

function TeamPanel({ inventory }: { inventory: Inventory }) {
  const emailId = useId()
  const [team, setTeam] = useState<TeamMember[] | null>(null)
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setTeam(await inventory.listTeam())
  }

  useEffect(() => {
    void load()
    // Only ever needs to run once per mount — invite/remove reload it themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const invite = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = email.trim()
    if (!trimmed) return
    setError(null)
    setInfo(null)
    setBusy(true)
    const result = await inventory.inviteEmployee(trimmed)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setInfo(
      result.value.emailSent === true
        ? `Invited — a sign-in email is on its way to ${trimmed}.`
        : result.value.emailSent === false
          ? `Added ${trimmed} to your team, but the sign-in email couldn't be sent automatically — ask them to visit the site and sign in with this exact email themselves.`
          : `Added ${trimmed} to your team.`,
    )
    setEmail('')
    await load()
  }

  const remove = async (member: TeamMember) => {
    setError(null)
    const result = await inventory.removeTeamMember(member.id)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await load()
  }

  return (
    <section className="panel">
      <h2>Team</h2>
      <p className="muted">
        Invite an employee by email — we'll send them a sign-in link at that address, and once
        they use it they land in this business automatically, with restricted access: no cost or
        profit figures, no deleting products, no price overrides at checkout, no refunds,
        goodwill gestures or write-offs, and no approving a stocktake recount.
      </p>

      {team === null ? (
        <p className="muted" role="status">
          Loading team…
        </p>
      ) : (
        <ul className="plain-list channel-list">
          {team.map((member) => (
            <li key={member.id} className="channel-row">
              <span>
                {member.isYou ? 'You' : member.email} <span className="chip">{member.role}</span>
                {member.status === 'pending' && <span className="chip">Invited — awaiting sign-up</span>}
              </span>
              {!member.isYou && (
                <button
                  type="button"
                  className="button button-ghost"
                  aria-label={`Remove ${member.email}`}
                  onClick={() => remove(member)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {info && <p className="preview">{info}</p>}

      <form className="toolbar" onSubmit={invite}>
        <div className="field field-grow">
          <label htmlFor={emailId}>Invite an employee</label>
          <input
            id={emailId}
            type="email"
            value={email}
            autoComplete="off"
            placeholder="their.email@example.com"
            onChange={(event) => setEmail(event.target.value)}
          />
          <p className="hint">
            We'll email them a sign-in link. If it doesn't arrive, they can still sign in any time
            with this exact email to join.
          </p>
        </div>
        <div className="toolbar-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? 'Inviting…' : 'Invite'}
          </button>
        </div>
      </form>
    </section>
  )
}

type SettingsTab = 'profile' | 'team' | 'catalogue' | 'labels'

const SETTINGS_TABS: { key: SettingsTab; label: string; managerOnly?: boolean }[] = [
  { key: 'profile', label: 'Profile' },
  { key: 'team', label: 'Team', managerOnly: true },
  { key: 'catalogue', label: 'Catalogue' },
  { key: 'labels', label: 'Labels' },
]

export function SettingsScreen({ settings, inventory }: SettingsScreenProps) {
  const logoId = useId()
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<SettingsTab>('profile')
  const isManager = inventory.role === 'manager'

  // Never leave a non-manager sitting on the manager-only Team tab — e.g. if
  // their role changes after this screen already mounted, same reasoning
  // HistoryScreen's Activity tab guards against.
  useEffect(() => {
    if (!isManager && tab === 'team') setTab('profile')
  }, [isManager, tab])

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setError('Choose an image file (PNG, JPG or SVG).')
      return
    }

    try {
      const dataUrl = await resizeLogoForStorage(file)
      settings.setLogo(dataUrl)
      setError(null)
    } catch (cause) {
      if (isQuotaError(cause)) {
        setError(
          "That image is still too large to store even after resizing — try a simpler image, or crop it down before uploading.",
        )
        return
      }
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="screen">
      <div className="channel-picker" aria-label="Settings sections">
        {SETTINGS_TABS.filter((t) => !t.managerOnly || isManager).map((t) => (
          <button
            key={t.key}
            type="button"
            className={`button chip-button ${tab === t.key ? 'chip-button-active' : ''}`}
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'profile' && <AccountSettingsPanel inventory={inventory} />}

      {isManager && tab === 'team' && (
        <>
          {inventory.backend === 'supabase' && <PendingProfileChangesPanel inventory={inventory} />}
          <TeamPanel inventory={inventory} />
        </>
      )}

      {tab === 'catalogue' && (
        <>
          {isManager && <CategoriesPanel settings={settings} products={inventory.products} />}
          <SaleChannelsPanel settings={settings} />
        </>
      )}

      {tab === 'labels' && (
        <>
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

          <LabelTemplateEditor settings={settings} />
        </>
      )}
    </div>
  )
}
