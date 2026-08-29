import { describe, expect, it, vi } from 'vitest'
import { runDistribution, type DistributionElectronApi } from './compositeDistribution'
import { createDefaultCompositeV2Preset } from './compositeV2Defaults'
import type { CompositeV2DistributionConfig, CompositeV2SuccessItem } from './compositeV2Types'

function createConfig(overrides: Partial<CompositeV2DistributionConfig> = {}): CompositeV2DistributionConfig {
  return {
    enabled: true,
    startDate: '20260701',
    days: 3,
    mode: 'copy',
    randomize: false,
    skipWeekends: false,
    renameMode: 'date',
    modifyMd5: false,
    ...overrides,
  }
}

function createItems(paths: string[]): CompositeV2SuccessItem[] {
  return paths.map((path, index) => ({
    path,
    presetId: 'p1',
    presetName: '预设 A',
    channel: '渠道1',
    size: '1080x1920',
    index: index + 1,
  }))
}

function createMockApi(initialExisting: string[] = []) {
  const existing = new Set(initialExisting)
  const calls: Array<{ sourcePath: string; targetPath: string; mode: 'copy' | 'move' }> = []
  const removedDirs: string[] = []
  const api: DistributionElectronApi = {
    pathJoin: async (...parts: string[]) => parts.join('\\'),
    checkExists: async (path: string) => existing.has(path),
    distributeFile: async (input: {
      sourcePath: string
      targetPath: string
      mode: 'copy' | 'move'
      appendRandomByte?: boolean
    }) => {
      calls.push(input)
      existing.add(input.targetPath)
      return { success: true }
    },
    removeEmptyDir: async (dir: string) => {
      removedDirs.push(dir)
      return undefined
    },
  }
  return { api, calls, removedDirs }
}

describe('composite distribution', () => {
  it('appends a collision suffix instead of silently overwriting same-named files', async () => {
    const { api, calls } = createMockApi()
    // 两个文件原文件名中的日期不同，但替换为目标日期后同名 → 第二个必须自动改名
    const result = await runDistribution(
      createItems(['D:\\out\\20260701\\img_20260601.jpg', 'D:\\out\\20260701\\img_20260602.jpg']),
      createConfig({ renameMode: 'date', days: 1 }),
      api,
      [],
    )

    expect(result.success).toBe(2)
    expect(result.canceled).toBe(false)
    expect(calls.map((call) => call.targetPath)).toEqual([
      'D:\\out\\20260701\\img_20260701.jpg',
      'D:\\out\\20260701\\img_20260701_2.jpg',
    ])
  })

  it('skips colliding targets that already exist on disk', async () => {
    const { api, calls } = createMockApi(['D:\\out\\20260701\\img_20260701.jpg'])
    await runDistribution(
      createItems(['D:\\out\\20260701\\img_20260601.jpg']),
      createConfig({ renameMode: 'date', days: 1 }),
      api,
      [],
    )

    expect(calls[0]?.targetPath).toBe('D:\\out\\20260701\\img_20260701_2.jpg')
  })

  it('uses date-sequenced names in sequence mode with a date folder per day', async () => {
    const { api, calls } = createMockApi()
    const result = await runDistribution(
      createItems(['D:\\out\\20260701\\x.jpg', 'D:\\out\\20260701\\y.jpg', 'D:\\out\\20260701\\z.jpg']),
      createConfig({ renameMode: 'sequence', days: 3 }),
      api,
      [],
    )

    expect(result.success).toBe(3)
    expect(calls.map((call) => call.targetPath)).toEqual([
      'D:\\out\\20260701\\20260701_01.jpg',
      'D:\\out\\20260702\\20260702_01.jpg',
      'D:\\out\\20260703\\20260703_01.jpg',
    ])
  })

  it('skips weekends when skipWeekends is enabled', async () => {
    const { api, calls } = createMockApi()
    // 2026-07-03 是周五；跳过周六/周日 → 周五 07-03、下周一 07-06、下周二 07-07
    await runDistribution(
      createItems(['D:\\out\\20260703\\a.jpg', 'D:\\out\\20260703\\b.jpg', 'D:\\out\\20260703\\c.jpg']),
      createConfig({ startDate: '20260703', days: 3, skipWeekends: true }),
      api,
      [],
    )

    expect(calls.map((call) => call.targetPath)).toEqual([
      'D:\\out\\20260703\\a.jpg',
      'D:\\out\\20260706\\b.jpg',
      'D:\\out\\20260707\\c.jpg',
    ])
  })

  it('stops early and reports canceled when shouldCancel returns true', async () => {
    let distributed = 0
    const { api, calls } = createMockApi()
    const result = await runDistribution(
      createItems(['D:\\out\\20260701\\1.jpg', 'D:\\out\\20260701\\2.jpg', 'D:\\out\\20260701\\3.jpg']),
      createConfig({ renameMode: 'date' }),
      api,
      [],
      {
        shouldCancel: () => {
          distributed = calls.length
          return calls.length >= 2
        },
      },
    )

    expect(distributed).toBe(2)
    expect(calls).toHaveLength(2)
    expect(result.success).toBe(2)
    expect(result.canceled).toBe(true)
  })

  it('removes only real source directories after move mode', async () => {
    const { api, removedDirs } = createMockApi()
    await runDistribution(
      createItems(['D:\\out\\folderA\\20260701\\a.jpg', 'D:\\out\\folderB\\20260701\\b.jpg']),
      createConfig({ mode: 'move', renameMode: 'date' }),
      api,
      [],
    )

    expect(removedDirs).toEqual(['D:\\out\\folderA\\20260701', 'D:\\out\\folderB\\20260701'])
  })

  it('rejects an invalid start date without distributing', async () => {
    const { api, calls } = createMockApi()
    const result = await runDistribution(
      createItems(['D:\\out\\20260701\\a.jpg']),
      createConfig({ startDate: '2026-07-01' }),
      api,
      [],
    )

    expect(result.success).toBe(0)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(calls).toHaveLength(0)
  })

  it('keeps a stable date-replaced directory across all days (no nested date folders)', async () => {
    const { api, calls } = createMockApi()
    // 5 天 × 每天 1 个文件：所有文件必须落到"日期替换"后的独立目录。
    // 回归测试：全局正则 test() 的 lastIndex 状态曾导致目录在替换/嵌套间交替错乱。
    const result = await runDistribution(
      createItems([
        'D:\\out\\20260701\\a.jpg',
        'D:\\out\\20260701\\b.jpg',
        'D:\\out\\20260701\\c.jpg',
        'D:\\out\\20260701\\d.jpg',
        'D:\\out\\20260701\\e.jpg',
      ]),
      createConfig({ renameMode: 'date', days: 5 }),
      api,
      [],
    )

    expect(result.success).toBe(5)
    expect(calls.map((call) => call.targetPath)).toEqual([
      'D:\\out\\20260701\\a.jpg',
      'D:\\out\\20260702\\b.jpg',
      'D:\\out\\20260703\\c.jpg',
      'D:\\out\\20260704\\d.jpg',
      'D:\\out\\20260705\\e.jpg',
    ])
  })

  it('authorizes distribution roots and keeps the relative output structure', async () => {
    const { api, calls } = createMockApi()
    const authorizeOutputDirectory = vi.fn(async () => true)
    api.authorizeOutputDirectory = authorizeOutputDirectory
    // outRoot 用 / 分隔、item.path 用 \ 分隔：前缀匹配必须不受分隔符影响
    const preset = {
      ...createDefaultCompositeV2Preset(1),
      id: 'p1',
      outputRootPath: 'D:/out',
      distributionPath: 'D:\\dist',
    }

    const result = await runDistribution(
      createItems(['D:\\out\\20260701\\a.jpg', 'D:\\out\\20260701\\b.jpg']),
      createConfig({ renameMode: 'date', days: 1 }),
      api,
      [preset],
    )

    expect(authorizeOutputDirectory).toHaveBeenCalledWith('D:\\dist')
    expect(result.success).toBe(2)
    expect(calls.map((call) => call.targetPath)).toEqual(['D:\\dist\\20260701\\a.jpg', 'D:\\dist\\20260701\\b.jpg'])
  })

  it('skips distribution roots that fail authorization', async () => {
    const { api, calls } = createMockApi()
    const authorizeOutputDirectory = vi.fn(async () => false)
    api.authorizeOutputDirectory = authorizeOutputDirectory
    const preset = {
      ...createDefaultCompositeV2Preset(1),
      id: 'p1',
      outputRootPath: 'D:\\out',
      distributionPath: 'relative\\dist',
    }

    const result = await runDistribution(
      createItems(['D:\\out\\20260701\\a.jpg']),
      createConfig({ renameMode: 'date', days: 1 }),
      api,
      [preset],
    )

    expect(authorizeOutputDirectory).toHaveBeenCalledTimes(1)
    expect(result.success).toBe(0)
    expect(result.errors.some((error) => error.includes('未授权'))).toBe(true)
    expect(calls).toHaveLength(0)
  })
})
