import { useCallback, useState, type CSSProperties } from 'react'

export const LARGE_MODAL_SIZE_STYLE = {
  width: '80vw',
  height: '80vh',
  maxWidth: 'none',
} satisfies CSSProperties

function getStoredLargeModalMode(storageKey: string) {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(storageKey) === 'large'
  } catch {
    return false
  }
}

function storeLargeModalMode(storageKey: string, largeView: boolean) {
  try {
    window.localStorage.setItem(storageKey, largeView ? 'large' : 'default')
  } catch {
    // Keep the current session usable if browser storage is unavailable.
  }
}

export function useLargeModalMode(storageKey: string) {
  const [largeView, setLargeView] = useState(() => getStoredLargeModalMode(storageKey))

  const toggleLargeView = useCallback(() => {
    setLargeView((current) => {
      const next = !current
      storeLargeModalMode(storageKey, next)
      return next
    })
  }, [storageKey])

  return { largeView, toggleLargeView }
}
