/* @vitest-environment jsdom */

/**
 * 核心页面级设计回归保障（静态契约 + renderToStaticMarkup smoke test）。
 *
 * 覆盖边界：
 * - 仅验证登记、文档、入口模块存在性与语义类使用，不执行像素对比。
 * - DesignSystemPreview smoke test 使用 renderToStaticMarkup（React 19 兼容），
 *   仅断言关键语义类出现在 HTML 输出中，不验证视觉外观。
 * - App/Header 根壳检查通过静态源码扫描，确认使用 ds canvas/surface 而非裸 gray。
 * - 不引入 Playwright 或任何重型浏览器自动化依赖。
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { pageCoverage } from './catalog'
import DesignSystemPreview from './DesignSystemPreview'

// ============================================================================
// 静态契约：pageCoverage 登记完整性
// ============================================================================

/** 顶层工作区 ID → 预期入口模块路径（相对于项目根）。
 *
 * 映射规则：
 * - gallery 是默认 appMode（appMode==='gallery'），其入口是 App.tsx 中的模式路由，
 *   而非 AssetLibraryWorkspace（素材库只是画廊模式下的一个子组件）。
 * - postprocess 映射到 CompositeWorkspace（App.tsx 中 appMode==='postprocess' 的实际渲染入口）。
 * - 其余工作区均有独立的功能 workspace 文件。
 */
const WORKSPACE_ENTRY_MODULES: Record<string, string> = {
  gallery: 'src/App.tsx',
  agent: 'src/components/AgentWorkspace.tsx',
  strategy: 'src/features/strategy/adapters/RequirementStrategyWorkspace.tsx',
  ordering: 'src/features/ordering/adapters/RequirementOrderingWorkspace.tsx',
  postprocess: 'src/features/composite/CompositeWorkspace.tsx',
  'requirement-prototype': 'src/features/requirementPrototype/AppShell.tsx',
}

/** 所有必须有 pageCoverage 登记的顶层工作区 ID */
const EXPECTED_WORKSPACE_IDS = Object.keys(WORKSPACE_ENTRY_MODULES)

/** 项目根目录（src/design-system/ 的上两级） */
const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..')

function projectPath(relative: string): string {
  return resolve(PROJECT_ROOT, relative)
}

describe('页面覆盖登记静态契约', () => {
  it('每个顶层工作区都在 catalog pageCoverage 中登记', () => {
    const registeredIds = new Set(pageCoverage.map((p) => p.id))
    const missing = EXPECTED_WORKSPACE_IDS.filter((id) => !registeredIds.has(id))
    expect(missing).toEqual([])
  })

  it('pageCoverage 中无多余/废弃登记', () => {
    const registeredIds = pageCoverage.map((p) => p.id)
    const stale = registeredIds.filter((id) => !EXPECTED_WORKSPACE_IDS.includes(id))
    expect(stale).toEqual([])
  })

  it('pageCoverage 的 id 唯一', () => {
    const ids = pageCoverage.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每个登记的 document 指向的 pages/*.md 文件存在', () => {
    const missingDocs: string[] = []
    for (const page of pageCoverage) {
      const docPath = projectPath(page.document)
      if (!existsSync(docPath)) {
        missingDocs.push(`${page.id}: ${page.document}`)
      }
    }
    expect(missingDocs).toEqual([])
  })

  it('每个顶层工作区的入口模块文件存在', () => {
    const missingEntries: string[] = []
    for (const [id, entryPath] of Object.entries(WORKSPACE_ENTRY_MODULES)) {
      const fullPath = projectPath(entryPath)
      if (!existsSync(fullPath)) {
        missingEntries.push(`${id}: ${entryPath}`)
      }
    }
    expect(missingEntries).toEqual([])
  })

  it('pageCoverage 中每个 document 路径格式为 design-system/doupao/pages/<id>.md', () => {
    const badPaths: string[] = []
    for (const page of pageCoverage) {
      const expected = `design-system/doupao/pages/${page.id}.md`
      if (page.document !== expected) {
        badPaths.push(`${page.id}: expected "${expected}", got "${page.document}"`)
      }
    }
    expect(badPaths).toEqual([])
  })

  it('入口模块映射表与 pageCoverage 的 id 集合一致', () => {
    const registeredIds = pageCoverage.map((p) => p.id).sort()
    const expectedIds = [...EXPECTED_WORKSPACE_IDS].sort()
    expect(registeredIds).toEqual(expectedIds)
  })
})

// ============================================================================
// 静态源码扫描：App/Header 根壳使用 ds canvas/surface 而非裸 gray
// ============================================================================

const ROOT_SHELL_FILES = {
  ...import.meta.glob('../components/Header.tsx', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../App.tsx', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>

/** 裸 gray/slate/zinc/neutral 工具类模式（不含 ds- 前缀） */
const BARE_GRAY_PATTERN =
  /bg-(?:white|gray-\d+|slate-\d+|zinc-\d+|neutral-\d+)|text-(?:gray-\d+|slate-\d+|zinc-\d+|neutral-\d+)|border-(?:gray-\d+|slate-\d+|zinc-\d+|neutral-\d+)/g

/**
 * ds 语义类模式：匹配 bg-ds-*, text-ds-*, border-ds-* 以及 --ds-color-* CSS 变量引用。
 * 覆盖两种 DS token 使用形式：
 * 1. Tailwind 语义类：bg-ds-surface, text-ds-text, border-ds-border 等
 * 2. CSS 自定义属性引用：--ds-color-canvas, --ds-color-text 等（用于 bg-[hsl(var(--ds-color-*))]）
 */
const DS_CANVAS_SURFACE_PATTERN = /bg-ds-|text-ds-|border-ds-|--ds-color-/

function normalizeKey(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\.\//, '')
}

describe('App/Header 根壳语义类契约', () => {
  it('glob 扫描命中 App.tsx 与 Header.tsx', () => {
    const paths = Object.keys(ROOT_SHELL_FILES).map(normalizeKey)
    expect(paths).toContain('App.tsx')
    expect(paths).toContain('components/Header.tsx')
    expect(Object.values(ROOT_SHELL_FILES).every((s) => typeof s === 'string' && s.length > 0)).toBe(true)
  })

  it('App.tsx 根壳使用 ds canvas/surface 语义类', () => {
    const entries = Object.entries(ROOT_SHELL_FILES).filter(([p]) => p.includes('App.tsx'))
    expect(entries.length).toBeGreaterThan(0)
    for (const [path, src] of entries) {
      const hasDsTokens = DS_CANVAS_SURFACE_PATTERN.test(src)
      expect(hasDsTokens, `${normalizeKey(path)}: 应使用 ds canvas/surface 语义类`).toBe(true)
    }
  })

  it('Header.tsx 根壳使用 ds canvas/surface 语义类', () => {
    const entries = Object.entries(ROOT_SHELL_FILES).filter(([p]) => p.includes('Header.tsx'))
    expect(entries.length).toBeGreaterThan(0)
    for (const [path, src] of entries) {
      const hasDsTokens = DS_CANVAS_SURFACE_PATTERN.test(src)
      expect(hasDsTokens, `${normalizeKey(path)}: 应使用 ds canvas/surface 语义类`).toBe(true)
    }
  })

  it('App.tsx 不使用裸 gray/slate/zinc/neutral 工具类', () => {
    const entries = Object.entries(ROOT_SHELL_FILES).filter(([p]) => p.includes('App.tsx'))
    expect(entries.length).toBeGreaterThan(0)
    for (const [path, src] of entries) {
      BARE_GRAY_PATTERN.lastIndex = 0
      const violations = src.match(BARE_GRAY_PATTERN) ?? []
      expect(violations, `${normalizeKey(path)}: 不应使用裸 gray/slate/zinc/neutral 类`).toEqual([])
    }
  })

  it('Header.tsx 不使用裸 gray/slate/zinc/neutral 工具类', () => {
    const entries = Object.entries(ROOT_SHELL_FILES).filter(([p]) => p.includes('Header.tsx'))
    expect(entries.length).toBeGreaterThan(0)
    for (const [path, src] of entries) {
      BARE_GRAY_PATTERN.lastIndex = 0
      const violations = src.match(BARE_GRAY_PATTERN) ?? []
      // Header.tsx 第 123 行有一个 divide-gray-200，这是已知的存量用法，作为深色变体 dark:divide-white/[0.08] 的浅色回退
      // 过滤掉 divide-gray-200（它不是 bg/text/border 主类）
      const significantViolations = violations.filter((v) => !v.startsWith('divide-'))
      expect(significantViolations, `${normalizeKey(path)}: 不应使用裸 gray/slate/zinc/neutral 类`).toEqual([])
    }
  })
})

// ============================================================================
// DesignSystemPreview renderToStaticMarkup smoke test（React 19 兼容）
// ============================================================================

describe('DesignSystemPreview 渲染 smoke test', () => {
  it('浅色主题下渲染的 HTML 包含关键语义类', () => {
    // jsdom 提供 document，不自行 mock/清空
    document.documentElement.classList.remove('dark')
    document.documentElement.setAttribute('data-skin', 'default')

    const html = renderToStaticMarkup(<DesignSystemPreview />)

    // 根元素使用 ds canvas 背景色
    expect(html).toContain('bg-[hsl(var(--ds-color-canvas))]')
    // 根元素使用 ds text 前景色
    expect(html).toContain('text-[hsl(var(--ds-color-text))]')
    // Surface 组件渲染（渲染 ds-surface 类）
    expect(html).toContain('ds-surface')
    // 输出非空且有实质内容
    expect(html.length).toBeGreaterThan(2000)
  })

  it('深色主题下渲染的 HTML 包含关键语义类', () => {
    document.documentElement.classList.add('dark')
    document.documentElement.setAttribute('data-skin', 'default')

    const html = renderToStaticMarkup(<DesignSystemPreview />)

    // 深色模式下根元素仍然使用 ds canvas 背景色
    expect(html).toContain('bg-[hsl(var(--ds-color-canvas))]')
    expect(html).toContain('text-[hsl(var(--ds-color-text))]')
    expect(html).toContain('ds-surface')
    expect(html.length).toBeGreaterThan(2000)

    // 清理
    document.documentElement.classList.remove('dark')
  })

  it('渲染输出包含主题切换按钮的 aria-label', () => {
    document.documentElement.classList.remove('dark')

    const html = renderToStaticMarkup(<DesignSystemPreview />)

    // 静态断言：HTML 中包含主题切换按钮（通过 aria-label 识别）
    expect(html).toContain('切换深色主题')
  })
})
