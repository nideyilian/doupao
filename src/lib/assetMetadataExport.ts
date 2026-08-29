import type { GeneratedAsset } from '../types'
import { isElectron, saveText, selectSavePath } from './localSave'

/**
 * 元数据 JSONL 导出（对应 docs/superpowers/specs/2026-08-20-self-contained-library-design.md §4.5）。
 * 一行一个素材，字段对齐 GeneratedAsset；undefined 字段省略（与 items.jsonl 同构，但仅作导出/检查用途，
 * 不是权威存储）。Electron 走原生保存对话框，浏览器走下载。
 */

/** 导出字段白名单：稳定、可文档化；新增素材字段不会静默混入清单。 */
const ASSET_METADATA_FIELDS = [
  'id',
  'imageId',
  'blobId',
  'currentVersionId',
  'status',
  'favorite',
  'rating',
  'colorLabel',
  'collectionIds',
  'tagIds',
  'notes',
  'origins',
  'primaryOriginKey',
  'parentAssetIds',
  'width',
  'height',
  'mimeType',
  'byteSize',
  'createdAt',
  'updatedAt',
  'trashedAt',
  'metadataVersion',
] as const

type AssetMetadataField = (typeof ASSET_METADATA_FIELDS)[number]

/** 提取白名单字段（JSON.stringify 会省略 undefined，得到紧凑稳定的行）。 */
export function pickAssetMetadataFields(asset: GeneratedAsset): Pick<GeneratedAsset, AssetMetadataField> {
  const picked = {} as Pick<GeneratedAsset, AssetMetadataField>
  for (const field of ASSET_METADATA_FIELDS) {
    const value = asset[field]
    if (value !== undefined) (picked as Record<string, unknown>)[field] = value
  }
  return picked
}

/** 构建 JSONL 文本：每行一个素材，末行换行；空数组返回空字符串。 */
export function buildAssetMetadataJsonl(assets: GeneratedAsset[]): string {
  if (assets.length === 0) return ''
  return assets.map((asset) => JSON.stringify(pickAssetMetadataFields(asset))).join('\n') + '\n'
}

function defaultExportFileName(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `doupao_assets_${ts}.jsonl`
}

function triggerBrowserDownload(content: string, fileName: string): void {
  const blob = new Blob([content], { type: 'application/x-ndjson;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export interface AssetMetadataExportResult {
  saved: boolean
  count: number
  filePath?: string
}

/** 导出素材元数据 JSONL；Electron 走保存对话框，浏览器直接下载。 */
export async function exportAssetMetadataJsonl(assets: GeneratedAsset[]): Promise<AssetMetadataExportResult> {
  const content = buildAssetMetadataJsonl(assets)
  const fileName = defaultExportFileName()
  if (isElectron()) {
    const filePath = await selectSavePath(fileName, [{ name: 'JSON Lines', extensions: ['jsonl'] }])
    if (!filePath) return { saved: false, count: assets.length }
    const ok = await saveText(filePath, content)
    return { saved: ok, count: assets.length, filePath: ok ? filePath : undefined }
  }
  triggerBrowserDownload(content, fileName)
  return { saved: true, count: assets.length }
}
