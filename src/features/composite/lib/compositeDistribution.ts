import type { CompositeV2DistributionConfig, CompositeV2Preset, CompositeV2SuccessItem } from './compositeV2Types'

export type DistributionResult = {
  success: number
  failed: number
  errors: string[]
  /** 用户中途取消时为 true，调用方据此把状态标记为 canceled 而不是 failed/completed */
  canceled: boolean
}

export type DistributionOptions = {
  onProgress?: (completed: number, total: number) => void
  onSuccess?: (item: { originalPath: string; targetPath: string }) => void
  onFailure?: (item: { originalPath: string; targetPath: string; error: string }) => void
  /** 返回 true 时尽快停止剩余分发（已完成的保持完成） */
  shouldCancel?: () => boolean
}

export type DistributionElectronApi = {
  pathJoin: (...paths: string[]) => Promise<string>
  /** 目标路径是否已存在，用于碰撞检测，避免静默覆盖同名文件 */
  checkExists?: (path: string) => Promise<boolean>
  /** 授权分配目标根目录（对应主进程 authorizeCompositeOutputDirectory）：
   *  主进程 distributeFile 只允许写入"允许根"内的路径，未授权的 distributionPath 会导致全部分配失败 */
  authorizeOutputDirectory?: (dir: string) => Promise<boolean>
  distributeFile?: (input: {
    sourcePath: string
    targetPath: string
    mode: 'copy' | 'move'
    appendRandomByte?: boolean
  }) => Promise<{ success: boolean; error?: string }>
  removeEmptyDir?: (dir: string) => Promise<unknown>
}

// 匹配 20260101 这类日期段。不能用 \b：`img_20260601.jpg` 中下划线是单词字符，
// \b 在 _2 之前不成立，会导致下划线分隔的常见文件名（如 xxx_20260601.jpg）日期替换失效。
// 用"前后都不是数字"来界定日期段。
// 注意：test 用非全局副本——全局正则的 test() 会推进 lastIndex，
// 同一目录逐天分配时交替命中/失败，导致目录在"替换"与"嵌套日期子文件夹"间错乱。
const DATE_SEGMENT_TEST = /(?<!\d)(20\d{6})(?!\d)/
const DATE_SEGMENT_PATTERN = /(?<!\d)(20\d{6})(?!\d)/g

function dirnameOf(path: string): string {
  return path.replace(/[/\\][^/\\]+$/, '')
}

async function joinPath(api: DistributionElectronApi, ...parts: string[]): Promise<string> {
  return await api.pathJoin(...parts)
}

/** 路径比较前统一分隔符并去掉尾部分隔符：item.path（主进程 path.join，\ 分隔）
 *  与 outputRoot（用户输入/模板解析，可能 / 分隔）直接 startsWith 会失效 */
function normalizePathForCompare(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * 目标文件碰撞检测：目标已存在时追加 `_2`、`_3`…… 序号（扩展名之前），
 * 而不是直接覆盖同名文件。`move` 模式下覆盖意味着源文件丢失，必须避免。
 */
async function resolveNonCollidingTarget(
  api: DistributionElectronApi,
  targetDir: string,
  fileName: string,
): Promise<string> {
  const baseTarget = await joinPath(api, targetDir, fileName)
  if (!api.checkExists) return baseTarget
  if (!(await api.checkExists(baseTarget))) return baseTarget

  const dot = fileName.lastIndexOf('.')
  const stem = dot >= 0 ? fileName.slice(0, dot) : fileName
  const ext = dot >= 0 ? fileName.slice(dot) : ''
  let suffix = 2
  // 防御性上限：极端情况下同目录同名文件过多时停止猜测，直接交给调用方报错
  while (suffix <= 1000) {
    const candidate = await joinPath(api, targetDir, `${stem}_${suffix}${ext}`)
    if (!(await api.checkExists(candidate))) return candidate
    suffix += 1
  }
  return baseTarget
}

export async function runDistribution(
  items: CompositeV2SuccessItem[],
  config: CompositeV2DistributionConfig,
  electronApi: DistributionElectronApi,
  presets: CompositeV2Preset[],
  options?: DistributionOptions,
): Promise<DistributionResult> {
  const shouldCancel = options?.shouldCancel ?? (() => false)
  const result: DistributionResult = { success: 0, failed: 0, errors: [], canceled: false }

  if (!config.enabled || items.length === 0 || config.days <= 0) {
    return result
  }

  // 1. Parse start date
  const dateMatch = config.startDate.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (!dateMatch) {
    result.errors.push(`起始日期格式错误，期望 YYYYMMDD，实际为: ${config.startDate}`)
    return result
  }
  const currentDate = new Date(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]))

  // 2. Generate target dates
  const targetDates: string[] = []
  while (targetDates.length < config.days) {
    if (config.skipWeekends) {
      const dayOfWeek = currentDate.getDay()
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        currentDate.setDate(currentDate.getDate() + 1)
        continue
      }
    }
    const yyyy = currentDate.getFullYear()
    const mm = String(currentDate.getMonth() + 1).padStart(2, '0')
    const dd = String(currentDate.getDate()).padStart(2, '0')
    targetDates.push(`${yyyy}${mm}${dd}`)
    currentDate.setDate(currentDate.getDate() + 1)
  }

  // 3. Group files by their original parent directory / configured distribution paths
  // 每个目标文件夹独立执行；preset.distributionPath 或渠道覆盖的 distributionPaths 决定落点
  const groupedItems = new Map<string, CompositeV2SuccessItem[]>()
  // 授权过的分配目标根（主进程白名单：未授权目录 distributeFile 会拒绝写入）
  const authorizedDistRoots = new Set<string>()

  for (const item of items) {
    const preset = presets.find((p) => p.id === item.presetId)

    let distPaths: string[] = []
    const overrideGroup = preset?.outputRuleGroupsOverride?.find((g) => g.name === item.channel)
    if (overrideGroup?.distributionPaths && overrideGroup.distributionPaths.length > 0) {
      const validPaths = overrideGroup.distributionPaths.filter((p: string) => p.trim() !== '')
      if (validPaths.length > 0) distPaths = validPaths
    }

    if (distPaths.length === 0) {
      const presetDistPath = preset?.distributionPath?.trim()
      if (presetDistPath) distPaths = [presetDistPath]
    }

    const originalDir = dirnameOf(item.path)

    // If no dist paths, just use the original dir
    if (distPaths.length === 0) {
      const group = groupedItems.get(originalDir) || []
      group.push(item)
      groupedItems.set(originalDir, group)
      continue
    }

    // If there are dist paths, we create a group for EACH dist path
    for (const baseDistDir of distPaths) {
      // 分配目标是独立目录时，必须先授权（主进程只允许写入"允许根"内的路径）。
      // 授权失败（例如相对路径、空目录）→ 记入错误并跳过该目标，避免整组静默失败。
      if (!authorizedDistRoots.has(baseDistDir)) {
        let authorized: boolean
        try {
          authorized = (await electronApi.authorizeOutputDirectory?.(baseDistDir)) ?? true
        } catch {
          authorized = false
        }
        if (!authorized) {
          result.errors.push(`分配目标未授权或不是绝对路径: ${baseDistDir}`)
          continue
        }
        authorizedDistRoots.add(baseDistDir)
      }

      let dir = originalDir
      const outRoot = preset?.outputRootPath?.trim()
      const normalizedDir = normalizePathForCompare(dir)
      const normalizedOutRoot = outRoot ? normalizePathForCompare(outRoot) : ''
      if (outRoot && normalizedDir.startsWith(normalizedOutRoot)) {
        const relative = normalizedDir.slice(normalizedOutRoot.length).replace(/^[/\\]+/, '')
        dir = await joinPath(electronApi, baseDistDir, relative)
      } else {
        dir = baseDistDir
      }

      const group = groupedItems.get(dir) || []
      group.push(item)
      groupedItems.set(dir, group)
    }
  }

  // 4. Distribute files for each group
  let totalOperations = 0
  for (const groupItems of groupedItems.values()) {
    totalOperations += groupItems.length
  }
  let completedOperations = 0
  // move 模式下需要清理的源目录（按实际文件所在目录收集，而不是分发目标目录）
  const sourceDirsToClean = new Set<string>()

  outer: for (const [originalDir, groupItems] of groupedItems.entries()) {
    // Shuffle if needed
    const filesToDistribute = [...groupItems]
    if (config.randomize) {
      for (let i = filesToDistribute.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        const temp = filesToDistribute[i]!
        filesToDistribute[i] = filesToDistribute[j]!
        filesToDistribute[j] = temp
      }
    }

    // Average distribution
    const totalFiles = filesToDistribute.length
    const days = targetDates.length
    const baseCount = Math.floor(totalFiles / days)
    const remainder = totalFiles % days

    let fileIndex = 0
    for (let dayIndex = 0; dayIndex < days; dayIndex++) {
      if (shouldCancel()) {
        result.canceled = true
        break outer
      }
      const targetDate = targetDates[dayIndex]!
      const countForThisDay = baseCount + (dayIndex < remainder ? 1 : 0)

      // Calculate target directory (始终使用日期来区分文件夹批次)
      // 如果原路径中存在类似 20260701 的日期，则替换它；否则，尝试在末尾追加日期子文件夹
      // 注意用非全局的 DATE_SEGMENT_TEST 做判断，避免全局正则 lastIndex 状态导致的交替错乱
      const targetDir = DATE_SEGMENT_TEST.test(originalDir)
        ? originalDir.replace(DATE_SEGMENT_PATTERN, targetDate)
        : await joinPath(electronApi, originalDir, targetDate)

      const folderBasename = targetDir.split(/[/\\]/).pop() || targetDate

      for (let k = 0; k < countForThisDay; k++) {
        if (shouldCancel()) {
          result.canceled = true
          break outer
        }
        if (fileIndex >= totalFiles) break
        const item = filesToDistribute[fileIndex]!
        fileIndex++

        const originalFileName = item.path.split(/[/\\]/).pop() || ''

        let targetFileName: string
        if (config.renameMode === 'date') {
          // 仅替换原文件名中的日期；无日期时保留原名（碰撞由 resolveNonCollidingTarget 兜底）
          targetFileName = originalFileName.replace(DATE_SEGMENT_PATTERN, targetDate)
        } else {
          // sequence mode: 完全按照文件夹命名来命名文件，并追加序号
          const lastDot = originalFileName.lastIndexOf('.')
          const ext = lastDot !== -1 ? originalFileName.slice(lastDot) : ''
          targetFileName = `${folderBasename}_${String(k + 1).padStart(2, '0')}${ext}`
        }

        // Use electronAPI to pathJoin + 碰撞检测，绝不静默覆盖
        try {
          const targetPath = await resolveNonCollidingTarget(electronApi, targetDir, targetFileName)

          const opResult = await electronApi.distributeFile?.({
            sourcePath: item.path,
            targetPath,
            mode: config.mode,
            appendRandomByte: config.modifyMd5,
          })

          if (opResult?.success) {
            result.success++
            if (config.mode === 'move') sourceDirsToClean.add(dirnameOf(item.path))
            options?.onSuccess?.({ originalPath: item.path, targetPath })
          } else {
            result.failed++
            const errorMsg = opResult?.error || 'Unknown error'
            result.errors.push(`操作失败: ${item.path} -> ${targetPath} (${errorMsg})`)
            options?.onFailure?.({ originalPath: item.path, targetPath, error: errorMsg })
          }
        } catch (error) {
          result.failed++
          const message = error instanceof Error ? error.message : String(error)
          result.errors.push(`异常: ${message}`)
          options?.onFailure?.({ originalPath: item.path, targetPath: '', error: message })
        } finally {
          completedOperations++
          options?.onProgress?.(completedOperations, totalOperations)
        }
      }
    }
  }

  // After moving files out of their source dirs, try to remove the now-empty dirs
  if (config.mode === 'move') {
    for (const sourceDir of sourceDirsToClean) {
      try {
        await electronApi.removeEmptyDir?.(sourceDir)
      } catch {
        // ignore errors on folder deletion (非空目录等场景直接跳过)
      }
    }
  }

  return result
}
