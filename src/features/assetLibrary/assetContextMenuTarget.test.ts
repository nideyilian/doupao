// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { GeneratedAsset } from '../../types'
import { findCardImageAsset, resolveAssetContextMenuScope } from './assetContextMenuTarget'

function makeAsset(id: string, imageId: string): GeneratedAsset {
  return {
    id,
    imageId,
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
    trashedAt: null,
    favorite: false,
    rating: 0,
    collectionIds: [],
    tagIds: [],
    origins: [],
    primaryOriginKey: null,
    parentAssetIds: [],
    metadataVersion: 1,
  }
}

const assets = [makeAsset('a1', 'img-1'), makeAsset('a2', 'img-2'), makeAsset('a3', 'img-3')]

/** 造一棵 <div> 卡片 > <img data-image-id> 的树（与 TaskCard 实际结构一致），返回卡片与 img。 */
function mountCardImage(imageId?: string) {
  const card = document.createElement('div')
  const img = document.createElement('img')
  if (imageId) img.setAttribute('data-image-id', imageId)
  card.appendChild(img)
  document.body.appendChild(card)
  return { card, img }
}

describe('findCardImageAsset', () => {
  it('命中卡内图片时返回该图片对应的素材（而不是卡片首张）', () => {
    const { img } = mountCardImage('img-3')
    expect(findCardImageAsset(img, assets)?.id).toBe('a3')
  })

  it('命中图片上的角标覆盖层时返回 undefined，交回整卡处理', () => {
    // TaskCard 里角标是 img 的兄弟节点（绝对定位浮在图上），命中它不该被当成点了图片。
    const { card } = mountCardImage('img-1')
    const badge = document.createElement('span')
    card.appendChild(badge)
    expect(findCardImageAsset(badge, assets)).toBeUndefined()
  })

  it('落点不是图片（卡片头部/空白）时返回 undefined', () => {
    const { card } = mountCardImage('img-1')
    const header = document.createElement('div')
    card.appendChild(header)
    expect(findCardImageAsset(header, assets)).toBeUndefined()
    expect(findCardImageAsset(card, assets)).toBeUndefined()
  })

  it('图片没有 data-image-id 时返回 undefined', () => {
    const { img } = mountCardImage()
    expect(findCardImageAsset(img, assets)).toBeUndefined()
  })

  it('data-image-id 不属于该卡片时返回 undefined', () => {
    const { img } = mountCardImage('img-unknown')
    expect(findCardImageAsset(img, assets)).toBeUndefined()
  })

  it('target 不是 Element（如 window / null）时不抛错', () => {
    expect(findCardImageAsset(null, assets)).toBeUndefined()
    expect(findCardImageAsset(window, assets)).toBeUndefined()
  })

  it('卡片没有素材时返回 undefined', () => {
    const { img } = mountCardImage('img-1')
    expect(findCardImageAsset(img, [])).toBeUndefined()
  })
})

describe('resolveAssetContextMenuScope', () => {
  it('右键未选中的图片 → 只操作这一张（单选菜单）', () => {
    expect(resolveAssetContextMenuScope(['a2', 'a3'], 'a1')).toEqual({ assetIds: ['a1'], actionScope: 'single' })
  })

  it('右键已选中的图片且选区不止一张 → 操作整个选区（多选菜单）', () => {
    expect(resolveAssetContextMenuScope(['a1', 'a2', 'a3'], 'a2')).toEqual({
      assetIds: ['a1', 'a2', 'a3'],
      actionScope: 'multi',
    })
  })

  it('右键已选中的图片但选区只有一张 → 仍是单选菜单', () => {
    expect(resolveAssetContextMenuScope(['a1'], 'a1')).toEqual({ assetIds: ['a1'], actionScope: 'single' })
  })

  it('没有任何选中时按单选处理', () => {
    expect(resolveAssetContextMenuScope([], 'a1')).toEqual({ assetIds: ['a1'], actionScope: 'single' })
  })

  it('选区里混有不在当前结果中的 id 时原样带出，交给菜单按 assetsById 过滤', () => {
    expect(resolveAssetContextMenuScope(['a1', 'gone'], 'a1').assetIds).toEqual(['a1', 'gone'])
  })
})
