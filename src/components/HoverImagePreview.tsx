export interface HoverPreviewState {
  imageId: string
  src: string
  left: number
  top: number
  width: number
  height: number
}

interface Props {
  preview: HoverPreviewState
  sizeText?: string
  zIndex?: number
}

export default function HoverImagePreview({ preview, sizeText, zIndex = 70 }: Props) {
  return (
    <div
      className="pointer-events-none fixed hidden overflow-hidden rounded-ds-lg border border-white/15 bg-black/85 p-2 shadow-2xl backdrop-blur-md md:block"
      style={{
        left: preview.left,
        top: preview.top,
        width: preview.width,
        height: preview.height,
        zIndex,
      }}
    >
      <img src={preview.src} data-image-id={preview.imageId} className="h-full w-full object-contain" alt="" />
      {sizeText && (
        <span
          aria-label="图片尺寸"
          className="absolute right-3 top-3 rounded-md bg-black/65 px-2 py-1 text-xs font-medium tabular-nums text-white shadow-sm backdrop-blur-sm"
        >
          {sizeText}
        </span>
      )}
    </div>
  )
}
