import path from 'path'
import { describe, expect, it } from 'vitest'
import { parseManagedImagePath } from './library-image-watcher'

describe('parseManagedImagePath', () => {
  it('extracts an image id from a managed cache image', () => {
    expect(parseManagedImagePath('D:\\Library', 'cache-images\\sha256-abc.webp')).toEqual({
      path: path.join('D:\\Library', 'cache-images', 'sha256-abc.webp'),
      imageId: 'sha256-abc',
    })
  })

  it('keeps workspace image paths for renderer-side task mapping', () => {
    expect(parseManagedImagePath('D:\\Library', 'images\\项目\\image.png')).toEqual({
      path: path.join('D:\\Library', 'images', '项目', 'image.png'),
    })
  })

  it('ignores metadata, thumbnails and unrelated files', () => {
    expect(parseManagedImagePath('D:\\Library', 'tasks\\task.json')).toBeNull()
    expect(parseManagedImagePath('D:\\Library', 'thumbs\\image.webp')).toBeNull()
    expect(parseManagedImagePath('D:\\Library', 'images\\prompt.txt')).toBeNull()
    expect(parseManagedImagePath('D:\\Library', 'images\\..\\outside.png')).toBeNull()
  })
})
