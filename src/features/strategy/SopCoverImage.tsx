import { useEffect, useState } from 'react'
import { ImageIcon } from '../../design-system/icons'
import { ensureImageThumbnailCached, subscribeImageThumbnail } from '../../store'

export default function SopCoverImage({
  imageId,
  alt,
  className = '',
  fallbackText,
}: {
  imageId?: string
  alt: string
  className?: string
  fallbackText?: string
}) {
  const [src, setSrc] = useState('')

  useEffect(() => {
    setSrc('')
    if (!imageId) return
    let active = true
    const apply = (thumbnail: { dataUrl: string }) => {
      if (active) setSrc(thumbnail.dataUrl)
    }
    const unsubscribe = subscribeImageThumbnail(imageId, apply)
    void ensureImageThumbnailCached(imageId).then((thumbnail) => thumbnail && apply(thumbnail))
    return () => {
      active = false
      unsubscribe()
    }
  }, [imageId])

  return (
    <span
      data-sop-cover-image-id={imageId || undefined}
      className={`flex shrink-0 items-center justify-center overflow-hidden bg-ds-subtle text-ds-text-subtle ${className}`}
    >
      {src ? (
        <img src={src} alt={alt} className="h-full w-full object-cover" />
      ) : fallbackText ? (
        <span aria-hidden="true" className="text-xs font-semibold">
          {fallbackText}
        </span>
      ) : (
        <ImageIcon aria-hidden="true" size={18} />
      )}
    </span>
  )
}
