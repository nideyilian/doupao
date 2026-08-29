import { useEffect, useState } from 'react'
import { ImageIcon } from '../../../design-system/icons'
import { ensureImageCached } from '../../../store'
import type { StrategyImageProps } from '../StrategyGrid'

export default function StrategyImage({ imageId, alt, className = '' }: StrategyImageProps) {
  const [dataUrl, setDataUrl] = useState('')

  useEffect(() => {
    let active = true
    if (!imageId) {
      setDataUrl('')
      return
    }
    void ensureImageCached(imageId).then((value) => {
      if (active) setDataUrl(value ?? '')
    })
    return () => {
      active = false
    }
  }, [imageId])

  if (!dataUrl) {
    return (
      <div
        className={`flex items-center justify-center bg-ds-surface text-ds-muted dark:bg-ds-surface dark:text-ds-muted ${className}`}
        aria-label={`${alt}暂无封面`}
      >
        <ImageIcon size={28} aria-hidden="true" />
      </div>
    )
  }

  return <img src={dataUrl} alt={alt} loading="lazy" className={`object-cover ${className}`} />
}
