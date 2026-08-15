export const RECENT_EMAILS_STORAGE_KEY = 'stockflow.recentEmails.v1'

/** How many past sign-in emails to keep — the sign-in screen is a small
 * dropdown, not a full address book. */
const MAX_RECENT_EMAILS = 5

function read(storage: Storage): string[] {
  const raw = storage.getItem(RECENT_EMAILS_STORAGE_KEY)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === 'string')
  } catch {
    return []
  }
}

/**
 * Remembered sign-in emails for this device — purely a local convenience so
 * the sign-in screen can offer them as click-to-fill suggestions (see
 * AuthScreen.tsx) instead of retyping the address every time. Nothing here
 * is synced or sent anywhere; it's just localStorage on this one device.
 *
 * This exists because retyping is exactly how the app ends up with more
 * than one "single user" account: a one-character typo in the email during
 * magic-link sign-in silently creates a brand new, completely empty
 * account rather than erroring — see the account-diagnosis notes. Picking
 * a remembered address from the list sidesteps that entirely.
 */
export function loadRecentEmails(storage: Storage = localStorage): string[] {
  return read(storage)
}

/** Records a used email as the most recent (case-insensitive de-duped) and
 * returns the updated list, so a caller can update its own state directly
 * without a second read. */
export function addRecentEmail(email: string, storage: Storage = localStorage): string[] {
  const trimmed = email.trim()
  if (!trimmed) return read(storage)

  const existing = read(storage)
  const deduped = existing.filter((saved) => saved.toLowerCase() !== trimmed.toLowerCase())
  const next = [trimmed, ...deduped].slice(0, MAX_RECENT_EMAILS)
  storage.setItem(RECENT_EMAILS_STORAGE_KEY, JSON.stringify(next))
  return next
}
