import { describe, expect, it } from 'vitest'
import { normalizeSettings } from './apiProfiles'
import { applyThemeMode, THEME_TRANSITION_CLASS, THEME_TRANSITION_DURATION_MS, normalizeThemeMode } from './theme'

describe('normalizeThemeMode', () => {
  it('defaults missing or invalid values to light', () => {
    expect(normalizeThemeMode(undefined)).toBe('light')
    expect(normalizeThemeMode('system')).toBe('light')
  })

  it('keeps explicit light and dark values', () => {
    expect(normalizeThemeMode('light')).toBe('light')
    expect(normalizeThemeMode('dark')).toBe('dark')
  })
})

describe('settings themeMode', () => {
  it('normalizes legacy settings to manual light mode', () => {
    expect(normalizeSettings({}).themeMode).toBe('light')
  })

  it('keeps manual dark mode in settings', () => {
    expect(normalizeSettings({ themeMode: 'dark' }).themeMode).toBe('dark')
  })
})

describe('applyThemeMode', () => {
  function createRoot() {
    const classes = new Set<string>()
    return {
      classList: {
        add: (name: string) => classes.add(name),
        remove: (name: string) => classes.delete(name),
        contains: (name: string) => classes.has(name),
        toggle: (name: string, force?: boolean) => {
          if (force === false) {
            classes.delete(name)
            return false
          }
          classes.add(name)
          return true
        },
      },
      style: { colorScheme: '' },
    } as unknown as HTMLElement
  }

  it('adds the dark class and color scheme for dark mode', () => {
    const root = createRoot()

    applyThemeMode('dark', root)

    expect(root.classList.contains('dark')).toBe(true)
    expect(root.style.colorScheme).toBe('dark')
  })

  it('removes the dark class and sets light color scheme for light mode', () => {
    const root = createRoot()
    root.classList.add('dark')

    applyThemeMode('light', root)

    expect(root.classList.contains('dark')).toBe(false)
    expect(root.style.colorScheme).toBe('light')
  })

  it('adds and schedules removal of the theme transition class when requested', () => {
    const root = createRoot()
    let scheduledDelay = 0
    const scheduledCallbacks: Array<() => void> = []

    applyThemeMode('dark', root, {
      transition: true,
      schedule: (callback, delay) => {
        scheduledCallbacks.push(callback)
        scheduledDelay = delay
      },
    })

    expect(root.classList.contains(THEME_TRANSITION_CLASS)).toBe(true)
    expect(scheduledDelay).toBe(THEME_TRANSITION_DURATION_MS)

    scheduledCallbacks[0]?.()

    expect(root.classList.contains(THEME_TRANSITION_CLASS)).toBe(false)
  })

  it('does not add the transition class by default', () => {
    const root = createRoot()

    applyThemeMode('dark', root)

    expect(root.classList.contains(THEME_TRANSITION_CLASS)).toBe(false)
  })
})
