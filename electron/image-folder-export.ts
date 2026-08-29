import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'fs'
import path from 'path'

/**
 * 批量导出图片到文件夹（Electron 原生"导出"，替代浏览器式锚点下载）。
 * 渲染端传 { fileName, sourcePath? | dataUrl? } 清单，主进程逐文件写盘：
 * - sourcePath：磁盘上已有原图（cache-images）→ 直接复制（不占渲染进程内存）；
 * - dataUrl：无本地路径（浏览器资源/临时图）→ 主进程解码写盘。
 * 文件名做安全清洗（拒绝路径分隔符 / .. 段 / 控制字符），同名由渲染端负责去重。
 */

export interface FolderImageFileEntry {
  fileName: string
  sourcePath?: string
  dataUrl?: string
}

export interface FolderImageExportResult {
  saved: number
  failed: Array<{ fileName: string; error: string }>
  total: number
}

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mime: string } {
  const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!matches) throw new Error('无效的图片数据')
  return { buffer: Buffer.from(matches[2]!, 'base64'), mime: matches[1]! }
}

/** 安全文件名：含路径分隔符（/ 或 \）或非法字符（<>:"|?*、控制字符）一律拒绝；空结果返回 null。 */
export function sanitizeExportFileName(fileName: string): string | null {
  if (/[\\/]/.test(fileName)) return null
  const cleaned = fileName
    .trim()
    // eslint-disable-next-line no-control-regex -- 文件名控制字符剥离是刻意行为
    .replace(/[<>:"|?*\x00-\x1f]+/g, '-')
    .replace(/\s+/g, ' ')
  if (!cleaned || cleaned === '.' || cleaned === '..') return null
  return cleaned.slice(0, 220)
}

/**
 * 批量写盘到目标目录（平铺，文件名经 sanitize 后不可能含路径分隔符）。
 * @param isPathAllowed 源路径白名单校验（注入 assertAllowedRealPath；测试可传恒真）
 */
export function exportImagesToFolderFiles(
  targetDir: string,
  files: FolderImageFileEntry[],
  isPathAllowed: (filePath: string) => string,
): FolderImageExportResult {
  const root = path.resolve(targetDir)
  mkdirSync(root, { recursive: true })
  const failed: Array<{ fileName: string; error: string }> = []
  let saved = 0

  for (const file of files) {
    const safeName = sanitizeExportFileName(file.fileName)
    if (!safeName) {
      failed.push({ fileName: file.fileName, error: '文件名非法' })
      continue
    }
    const hasSource = typeof file.sourcePath === 'string' && file.sourcePath.length > 0
    const hasData = typeof file.dataUrl === 'string' && file.dataUrl.length > 0
    if (hasSource === hasData) {
      failed.push({ fileName: file.fileName, error: '必须且只能提供 sourcePath 或 dataUrl 之一' })
      continue
    }
    const target = path.join(root, safeName)
    if (path.relative(root, target).startsWith('..')) {
      failed.push({ fileName: file.fileName, error: '路径越界' })
      continue
    }
    try {
      if (hasSource) {
        const safeSource = isPathAllowed(file.sourcePath!)
        if (!existsSync(safeSource)) throw new Error('源文件不存在')
        copyFileSync(safeSource, target)
        if (statSync(safeSource).size !== statSync(target).size) throw new Error('复制后大小校验失败')
      } else {
        const { buffer } = dataUrlToBuffer(file.dataUrl!)
        writeFileSync(target, buffer)
      }
      saved++
    } catch (err) {
      failed.push({ fileName: file.fileName, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return { saved, failed, total: files.length }
}
