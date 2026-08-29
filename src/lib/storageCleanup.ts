import type { StoredImage } from '../types'

export function shouldDeleteOrphanImage(
  image: Pick<StoredImage, 'createdAt'>,
  now: number,
  graceDays: number,
): boolean {
  if (image.createdAt == null) return true
  const graceMs = Math.max(0, graceDays) * 24 * 60 * 60 * 1000
  return now - image.createdAt >= graceMs
}
