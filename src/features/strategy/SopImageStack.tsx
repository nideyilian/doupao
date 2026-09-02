import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react'
import { ImageIcon } from '../../design-system/icons'
import { ensureImageCached, ensureImageThumbnailCached, subscribeImageThumbnail } from '../../store'
import type { TaskRecord } from '../../types'
import { getHoverPreviewPosition, getHoverPreviewSize } from '../../lib/hoverPreviewPosition'
import HoverImagePreview, { type HoverPreviewState } from '../../components/HoverImagePreview'
import { getSopCoverCandidates, type SopCoverCandidate } from './sopCover'
import type { SopLibraryItem } from './types'
import SopCoverImage from './SopCoverImage'

const MAX_STACK_IMAGES = 5
const PREVIEW_MAX_LONG_EDGE = 640

function StackThumbnail({ candidate, label }: { candidate: SopCoverCandidate; label: string }) {
  const [src, setSrc] = useState('')

  useEffect(() => {
    let active = true
    const apply = (thumbnail: { dataUrl: string }) => {
      if (active) setSrc(thumbnail.dataUrl)
    }
    const unsubscribe = subscribeImageThumbnail(candidate.imageId, apply)
    void ensureImageThumbnailCached(candidate.imageId).then((thumbnail) => thumbnail && apply(thumbnail))
    return () => {
      active = false
      unsubscribe()
    }
  }, [candidate.imageId])

  return src ? (
    <img src={src} alt="" className="h-full w-full object-cover" draggable={false} />
  ) : (
    <span className="flex h-full w-full items-center justify-center bg-ds-subtle text-ds-muted">
      <ImageIcon aria-hidden="true" size={16} />
      <span className="sr-only">{label}</span>
    </span>
  )
}

function getPreviewIndex(event: PointerEvent<HTMLButtonElement>, count: number) {
  const rect = event.currentTarget.getBoundingClientRect()
  if (rect.width <= 0 || count <= 1) return 0
  const ratio = Math.max(0, Math.min(0.999, (event.clientX - rect.left) / rect.width))
  return Math.min(count - 1, Math.floor(ratio * count))
}

export default function SopImageStack({
  item,
  tasks,
  onClick,
  onDoubleClick,
  title,
}: {
  item: SopLibraryItem
  tasks: TaskRecord[]
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  onDoubleClick: (event: MouseEvent<HTMLButtonElement>) => void
  title: string
}) {
  const candidates = useMemo(() => {
    const allCandidates = getSopCoverCandidates(item.id, tasks)
    const firstCandidates = allCandidates.slice(0, MAX_STACK_IMAGES)
    const selectedCover = item.coverImageId
      ? allCandidates.find((candidate) => candidate.imageId === item.coverImageId)
      : undefined
    if (!selectedCover || firstCandidates.some((candidate) => candidate.imageId === selectedCover.imageId)) {
      return firstCandidates
    }
    return [...firstCandidates.slice(0, MAX_STACK_IMAGES - 1), selectedCover]
  }, [item.coverImageId, item.id, tasks])
  const [preview, setPreview] = useState<HoverPreviewState | null>(null)
  const previewRequestRef = useRef(0)
  const previewIndexRef = useRef(0)

  const updatePreviewPosition = (event: PointerEvent<HTMLButtonElement>, current: HoverPreviewState) => {
    const position = getHoverPreviewPosition({
      pointerX: event.clientX,
      pointerY: event.clientY,
      previewWidth: current.width,
      previewHeight: current.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    })
    setPreview({ ...current, ...position })
  }

  const loadPreview = (candidate: SopCoverCandidate, event: PointerEvent<HTMLButtonElement>) => {
    const requestId = previewRequestRef.current + 1
    previewRequestRef.current = requestId
    void ensureImageCached(candidate.imageId).then((src) => {
      if (!src || previewRequestRef.current !== requestId) return
      const image = new Image()
      image.onload = () => {
        if (previewRequestRef.current !== requestId) return
        const size = getHoverPreviewSize({
          imageWidth: image.naturalWidth,
          imageHeight: image.naturalHeight,
          maxLongEdge: PREVIEW_MAX_LONG_EDGE,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        })
        const position = getHoverPreviewPosition({
          pointerX: event.clientX,
          pointerY: event.clientY,
          previewWidth: size.width,
          previewHeight: size.height,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        })
        setPreview({ imageId: candidate.imageId, src, ...position, ...size })
      }
      image.src = src
    })
  }

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== 'mouse' || candidates.length === 0) return
    const nextIndex = getPreviewIndex(event, candidates.length)
    if (nextIndex !== previewIndexRef.current) {
      previewIndexRef.current = nextIndex
      loadPreview(candidates[nextIndex], event)
    } else if (preview) {
      updatePreviewPosition(event, preview)
    }
  }

  const handlePointerEnter = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== 'mouse' || candidates.length === 0) return
    previewIndexRef.current = 0
    loadPreview(candidates[0], event)
  }

  const clearPreview = () => {
    previewRequestRef.current += 1
    setPreview(null)
  }

  if (candidates.length === 0) {
    return (
      <span className="sop-center-sop-stack-shell sop-center-sop-stack-shell--empty">
        <button
          type="button"
          className="sop-center-sop-cover sop-center-sop-empty-button"
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          aria-label={`选择 ${item.name}`}
          title={title}
        >
          <SopCoverImage
            imageId={item.coverImageId}
            alt={`${item.name} 封面`}
            fallbackText={item.name.trim().slice(0, 1) || 'S'}
            className="sop-center-sop-empty-cover rounded-lg"
          />
        </button>
      </span>
    )
  }

  return (
    <span className="sop-center-sop-stack-shell">
      <button
        type="button"
        className="sop-center-sop-cover sop-center-sop-stack-button"
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onPointerEnter={handlePointerEnter}
        onPointerMove={handlePointerMove}
        onPointerLeave={clearPreview}
        onPointerCancel={clearPreview}
        aria-label={`选择 ${item.name}`}
        title={title}
        data-sop-image-stack={item.id}
      >
        <span className="sop-center-sop-stack" aria-hidden="true">
          {candidates.map((candidate, index) => {
            const middle = (candidates.length - 1) / 2
            const style = {
              '--sop-stack-index': index,
              '--sop-stack-rotation': `${(index - middle) * 1.8}deg`,
              '--sop-stack-hover-rotation': `${(index - middle) * 0.7}deg`,
            } as CSSProperties
            return (
              <span
                key={candidate.imageId}
                className="sop-center-sop-stack__layer"
                style={style}
                data-sop-image-stack-layer={candidate.imageId}
              >
                {candidate.imageId === item.coverImageId ? (
                  <SopCoverImage imageId={candidate.imageId} alt="" className="h-full w-full rounded-none" />
                ) : (
                  <StackThumbnail candidate={candidate} label={`${item.name} 第 ${index + 1} 张生成图`} />
                )}
              </span>
            )
          })}
        </span>
      </button>
      {preview && (
        <HoverImagePreview
          preview={preview}
          sizeText={`${previewIndexRef.current + 1} / ${candidates.length}`}
          portal
        />
      )}
    </span>
  )
}
