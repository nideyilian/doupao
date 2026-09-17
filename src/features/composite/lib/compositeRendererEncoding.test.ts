import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 合成导出的一次编码可能就是 10MB+ 的成品图。同步 `canvas.toDataURL` 会把 jpeg 编码
 * 一次性跑在主线程上，批量导出时每一张都是一次可见冻结；`canvasToBlob` 把编码交给后台线程。
 *
 * 这是防回退守卫（同 `design-system/compliance.test.ts` 的做法）：
 * 谁把导出改回同步编码，这里立刻变红。编码量本来就一样（toBlob 与 toDataURL 等价），
 * 差别只在主线程有没有被占满 —— 所以「总耗时」看不出问题，只有这条断言能守住。
 */
const RENDERER_FILES = ['compositeRenderer.ts', 'compositeRendererV2.ts']

describe('合成导出必须走异步编码通道', () => {
  it.each(RENDERER_FILES)('%s 不出现同步 canvas.toDataURL', (fileName) => {
    const source = readFileSync(fileURLToPath(new URL(fileName, import.meta.url)), 'utf-8')
    expect(source).not.toMatch(/\bcanvas\.toDataURL\(/)
  })

  it.each(RENDERER_FILES)('%s 经由 canvasToBlob + blobToDataUrl 产出 dataUrl', (fileName) => {
    const source = readFileSync(fileURLToPath(new URL(fileName, import.meta.url)), 'utf-8')
    expect(source).toContain('canvasToBlob(')
    expect(source).toContain('blobToDataUrl(')
  })
})
