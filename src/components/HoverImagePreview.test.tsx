import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import HoverImagePreview from './HoverImagePreview'

const preview = {
  imageId: 'image-a',
  src: 'data:image/png;base64,a',
  left: 100,
  top: 120,
  width: 640,
  height: 360,
}

describe('HoverImagePreview', () => {
  it('shows the actual pixel dimensions in the upper-right label', () => {
    const html = renderToStaticMarkup(<HoverImagePreview preview={preview} sizeText="1536 × 1024" />)

    expect(html).toContain('aria-label="图片尺寸"')
    expect(html).toContain('1536 × 1024')
    expect(html).toContain('right-3 top-3')
  })

  it('omits the size label when dimensions are unavailable', () => {
    const html = renderToStaticMarkup(<HoverImagePreview preview={preview} sizeText="" />)

    expect(html).not.toContain('aria-label="图片尺寸"')
  })

  it('allows a modal to raise the preview above its own stacking layer', () => {
    const html = renderToStaticMarkup(<HoverImagePreview preview={preview} zIndex={90} />)

    expect(html).toContain('z-index:90')
  })
})
