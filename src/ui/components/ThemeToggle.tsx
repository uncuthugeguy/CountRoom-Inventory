import { useEffect, useState } from 'react'
import { applyTheme, getStoredTheme, setTheme as persistTheme, type Theme } from '../theme'

/** Same pattern as packages/branding/ThemeToggle.tsx in the Register/
 * Listings monorepo — this app is a separate repo, so it gets its own
 * copy rather than a shared import. */
export function useTheme(): [Theme, (next: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme())

  useEffect(() => {
    applyTheme(theme)
    // Only needs to run once on mount (in case the index.html boot script
    // didn't fire) — applyTheme() is idempotent so this is a cheap no-op
    // most of the time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const update = (next: Theme) => {
    setThemeState(next)
    persistTheme(next)
  }

  return [theme, update]
}

const OPTIONS: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

/** Light / Dark / System switch, styled like the settings-section chips
 * above it (SettingsScreen.tsx's `.button.chip-button` row). */
export function ThemeToggle() {
  const [theme, setThemeValue] = useTheme()
  return (
    <div role="group" aria-label="Appearance" className="channel-picker">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`button chip-button ${theme === opt.value ? 'chip-button-active' : ''}`}
          aria-pressed={theme === opt.value}
          onClick={() => setThemeValue(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
