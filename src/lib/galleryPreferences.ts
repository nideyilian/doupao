export type GalleryViewMode = 'tasks' | 'images'

export const GALLERY_VIEW_MODE_STORAGE_KEY = 'doupao.gallery-view-mode'

export function loadGalleryViewMode(): GalleryViewMode {
  if (typeof window === 'undefined') return 'tasks'
  try {
    return window.localStorage.getItem(GALLERY_VIEW_MODE_STORAGE_KEY) === 'images' ? 'images' : 'tasks'
  } catch {
    return 'tasks'
  }
}

export function saveGalleryViewMode(mode: GalleryViewMode) {
  try {
    window.localStorage.setItem(GALLERY_VIEW_MODE_STORAGE_KEY, mode)
  } catch {
    // Ignore unavailable local preference storage.
  }
}
