/**
 * Light/dark/system theme control — device-local (not a synced business
 * setting, so it deliberately does not go through useSettings.ts/Supabase).
 *
 * `<html>` gets a `data-theme="light"|"dark"` attribute, or no attribute at
 * all for "system" (letting styles.css's `@media (prefers-color-scheme:
 * dark)` block do the work — no listener needed to react to OS changes).
 * The choice persists to localStorage, and index.html inlines a copy of
 * this same read in <head> (see themeBootScript below) so the correct
 * theme is set before first paint.
 *
 * Kept as this app's own copy rather than a shared import — this repo is
 * separate from the countroom monorepo (Register/Listings), which has the
 * equivalent in packages/branding/theme.ts. Keep the two in sync by hand
 * if the approach ever changes.
 */
export type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'cr-theme'

export function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system'
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'system') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', theme)
  }
}

export function setTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Ignore — theme still applies for this session, just won't persist.
  }
  applyTheme(theme)
}

/** Mirrors the inline script in index.html's <head> — keep both in sync. */
export const THEME_STORAGE_KEY = STORAGE_KEY
