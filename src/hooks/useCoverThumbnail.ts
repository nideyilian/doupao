import { useEffect, useState } from 'react'
import { ensureImageThumbnailCached, subscribeImageThumbnail } from '../store'
import { getImage } from '../lib/db'

/**
 * 封面缩略图状态：加载 1024 缩略图（订阅更新）。
 * 缩略图与全图都拿不到时，检查图片记录是否还存在——记录也不存在说明
 * 源文件已丢失（用户此前删除过），标记 lost 以便 UI 显示「图片已丢失」，
 * 而不是无限停留在「加载中」的占位观感。
 */
export function useCoverThumbnail(imageId: string | undefined | null): { src: string; lost: boolean } {
  const [src, setSrc] = useState('')
  const [lost, setLost] = useState(false)

  useEffect(() => {
    setSrc('')
    setLost(false)
    if (!imageId) return
    let active = true
    const apply = (next: { dataUrl: string }) => {
      if (active) setSrc(next.dataUrl)
    }
    const unsubscribe = subscribeImageThumbnail(imageId, apply)
    void ensureImageThumbnailCached(imageId)
      .then((value) => {
        if (!active) return
        if (value) {
          apply(value)
          return
        }
        // 缩略图/回填均不可用：确认图片记录本身是否已不存在
        void getImage(imageId)
          .then((record) => {
            if (active && !record) setLost(true)
          })
          .catch(() => {})
      })
      .catch(() => {})
    return () => {
      active = false
      unsubscribe()
    }
  }, [imageId])

  return { src, lost }
}
