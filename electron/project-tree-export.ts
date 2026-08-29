import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'fs'
import path from 'path'

/**
 * 按项目树导出原图副本（方案 A：copy 语义，与库解耦）。
 * 渲染端构建「相对目标根的复制清单」，主进程逐文件复制（不走渲染进程内存），
 * 并在目标根写 export-manifest.jsonl（目标路径 / 源路径 / assetId 一行一个）。
 */

export interface ProjectCopyEntry {
  /** 源文件绝对路径（cache-images 原图） */
  sourcePath: string
  /** 相对目标根的路径，使用 / 分隔（如 "项目A/子项目A1/img.png"） */
  targetPath: string
  assetId?: string
}

export interface ProjectTreeExportResult {
  copied: number
  failed: Array<{ targetPath: string; error: string }>
  total: number
}

const MANIFEST_FILE = 'export-manifest.jsonl'

function isPathInside(targetPath: string, rootPath: string): boolean {
  const target = path.resolve(targetPath)
  const root = path.resolve(rootPath)
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * 复制清单文件到目标根。
 * @param isPathAllowed 源路径白名单校验（注入 assertAllowedRealPath；测试可传恒真）
 */
export function exportProjectTreeCopies(
  targetRoot: string,
  entries: ProjectCopyEntry[],
  isPathAllowed: (filePath: string) => string,
): ProjectTreeExportResult {
  const root = path.resolve(targetRoot)
  mkdirSync(root, { recursive: true })
  const failed: Array<{ targetPath: string; error: string }> = []
  const manifestLines: string[] = []
  let copied = 0

  for (const entry of entries) {
    let safeSource: string | null = null
    try {
      safeSource = isPathAllowed(entry.sourcePath)
    } catch {
      safeSource = null
    }
    if (!safeSource || !existsSync(safeSource)) {
      failed.push({ targetPath: entry.targetPath, error: '源文件不可读或不在允许目录内' })
      continue
    }
    // 目标路径防穿越：拒绝绝对路径 / .. 段 / 反斜杠；最终必须落在目标根内
    if (
      entry.targetPath.startsWith('/') ||
      entry.targetPath.includes('\\') ||
      entry.targetPath.split('/').some((segment) => segment === '..' || segment === '')
    ) {
      failed.push({ targetPath: entry.targetPath, error: '目标路径非法' })
      continue
    }
    const target = path.join(root, ...entry.targetPath.split('/'))
    if (!isPathInside(target, root)) {
      failed.push({ targetPath: entry.targetPath, error: '目标路径越界' })
      continue
    }
    try {
      mkdirSync(path.dirname(target), { recursive: true })
      copyFileSync(safeSource, target)
      if (statSync(safeSource).size !== statSync(target).size) {
        throw new Error('复制后大小校验失败')
      }
      copied++
      manifestLines.push(
        JSON.stringify({ targetPath: entry.targetPath, sourcePath: safeSource, assetId: entry.assetId ?? null }),
      )
    } catch (err) {
      failed.push({ targetPath: entry.targetPath, error: err instanceof Error ? err.message : String(err) })
    }
  }

  try {
    writeFileSync(
      path.join(root, MANIFEST_FILE),
      manifestLines.join('\n') + (manifestLines.length > 0 ? '\n' : ''),
      'utf-8',
    )
  } catch {
    // manifest 写失败不影响主体复制结果（只读清单，尽力而为）
  }
  return { copied, failed, total: entries.length }
}
