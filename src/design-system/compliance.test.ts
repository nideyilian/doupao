import { describe, it, expect } from 'vitest'

// 全仓 UI 合规回归测试：锁定规范明确禁止的模式，防止再次分叉。
// 覆盖：MASTER 6.1（不使用 transition: all）、MASTER 4.8（禁止任意数字 z-index，tooltip 为最高层）、
// MASTER 4.3（字号体系 12px 起）、MASTER 4.1（业务代码使用语义 Token，旧工具类只减不增）。

const sources: Record<string, string> = {
  ...import.meta.glob('../**/*.tsx', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../**/*.ts', { query: '?raw', import: 'default', eager: true }),
}

// 排除 design-system 自身（含根文件 ./xxx.tsx 与子目录 ../design-system/xxx）
const entries = Object.entries(sources).filter(([path]) => !path.includes('/design-system/') && !path.startsWith('./'))

/** 将 import.meta.glob 的路径（相对 design-system 目录）归一为快照键形式，如 components/InputBar.tsx */
function normalizeKey(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\.\//, '')
}

// ===== 持久化用户数据调色板豁免 =====
// 以下文件包含的 hex 色值是"持久化用户数据调色板"（如提示词变量色标、素材标签色），
// 而非 UI 组件 className / 内联 style 硬编码。它们由用户数据驱动，不消费设计 Token，
// 因此对 hex 规则豁免。其他规则（gray / rounded 等）继续检查。
// 新增豁免文件必须在此白名单中登记，否则合规测试报错。

const HEX_EXEMPT_FILES = new Set(['lib/promptVariableColors.ts', 'features/assetLibrary/colorLabels.ts'])

/** 文件级注释标记，声明该文件的 hex 为持久化用户数据调色板。 */
const HEX_EXEMPT_MARKER = /design-token-exempt:\s*persisted-user-color-palette/

/** 检测源文件是否包含豁免标记。 */
function hasHexExemptMarker(src: string): boolean {
  return HEX_EXEMPT_MARKER.test(src)
}

describe('UI 合规回归', () => {
  it('不使用 transition-all（MASTER 6.1：只声明实际变化的属性）', () => {
    const violations = entries
      .filter(([, src]) => /\btransition-all\b/.test(src))
      .map(([path]) => path.replace(/^\.\.\//, ''))
    expect(violations).toEqual([])
  })

  it('不使用任意数字 z-index（MASTER 4.8：禁止 z-[...]，改用 --ds-z-* token）', () => {
    const violations = entries
      .filter(([, src]) => /z-\[(?!var)[0-9]/.test(src))
      .map(([path]) => path.replace(/^\.\.\//, ''))
    expect(violations).toEqual([])
  })

  it('字号归一到 DS 体系：禁止 text-[8/9/10/11px]（MASTER 4.3：字号 12/13/14/16/20/24）', () => {
    const violations = entries
      .filter(([, src]) => /text-\[(?:8|9|10|11)px\]/.test(src))
      .map(([path]) => normalizeKey(path))
    expect(violations).toEqual([])
  })

  it('design-token-exempt: persisted-user-color-palette 标记仅允许出现在白名单文件中', () => {
    const violations: string[] = []
    for (const [path, src] of entries) {
      const key = normalizeKey(path)
      if (hasHexExemptMarker(src) && !HEX_EXEMPT_FILES.has(key)) {
        violations.push(`${key} 带有豁免标记但不在白名单中`)
      }
    }
    expect(violations).toEqual([])
  })

  it('白名单文件必须包含 design-token-exempt: persisted-user-color-palette 标记', () => {
    const missing: string[] = []
    for (const [path, src] of entries) {
      const key = normalizeKey(path)
      if (HEX_EXEMPT_FILES.has(key) && !hasHexExemptMarker(src)) {
        missing.push(`${key} 在白名单中但缺少豁免标记`)
      }
    }
    expect(missing).toEqual([])
  })
})

// ===== 存量旧工具类治理快照（只减不增）=====
// 背景：业务组件历史上有大量裸 Tailwind 旧类（bg-white / bg-gray-* / text-blue-* /
// rounded-xl 等）与写死 Hex，不消费语义 Token，是皮肤切换后观感不一致的根源。
// 治理方式：以下快照记录当前基线。任何文件的计数只允许下降（迁移旧类），
// 新增文件出现任何旧类即失败。新代码应使用设计系统组件与 ds.* / --ds-* Token。
// 更新快照：仅在完成一段旧类迁移后，重新生成快照并提交。
const LEGACY_PATTERNS: Record<string, RegExp> = {
  gray: /\b(?:bg-white|bg-gray-\d+|text-gray-\d+|border-gray-\d+|bg-slate-\d+|text-slate-\d+|border-slate-\d+|bg-zinc-\d+|text-zinc-\d+|border-zinc-\d+|bg-neutral-\d+|text-neutral-\d+|border-neutral-\d+)\b/g,
  brandBlue: /\b(?:bg-blue-\d+|text-blue-\d+|border-blue-\d+|ring-blue-\d+)\b/g,
  semantic:
    /\b(?:bg-emerald-\d+|text-emerald-\d+|bg-amber-\d+|text-amber-\d+|bg-red-\d+|text-red-\d+|bg-rose-\d+|text-rose-\d+)\b/g,
  rounded: /\brounded-(?:xl|2xl|3xl)\b/g,
  hex: /#[0-9a-fA-F]{3,8}\b/g,
}

const LEGACY_SNAPSHOT: Record<string, number> = {
  'components/AgentWorkspace.tsx|hex': 1,
  'components/DetailModal.tsx|hex': 8,
  'components/FavoriteCollections.tsx|hex': 5,
  'components/InputBar.tsx|hex': 7,
  'components/MaskEditorModal.tsx|hex': 16,
  'components/PromptVariableEditor.tsx|hex': 7,
  'components/SupportPromptModal.tsx|hex': 11,
  'features/assetLibrary/AssetBatchView.tsx|hex': 7,
  'features/assetLibrary/AssetGrid.tsx|hex': 7,
  'features/assetLibrary/AssetLibrarySidebar.tsx|hex': 10,
  'features/assetLibrary/AssetLibraryToolbar.tsx|hex': 7,
  'features/assetLibrary/AssetListView.tsx|hex': 7,
  'features/assetLibrary/AssetViewer.tsx|hex': 7,
  'features/composite/components/PresetLayerPanel.tsx|hex': 1,
  'features/composite/components/PresetNamingFields.tsx|hex': 0,
  'features/composite/lib/compositeDefaults.ts|hex': 18,
  'features/composite/lib/compositeRenderer.ts|hex': 1,
  'features/composite/lib/compositeRendererV2.ts|hex': 2,
  'features/composite/storeV2.ts|hex': 4,
  'features/requirementPrototype/manifests.ts|hex': 4,
  'lib/imagePostprocess.ts|hex': 1,
  'lib/watermarkEngine.ts|hex': 7,
  'lib/watermarkWorkbench.ts|hex': 4,
  'storePostprocess.ts|hex': 2,
}

describe('UI 合规治理（存量旧工具类只减不增）', () => {
  it('每个文件的旧类计数不超过基线快照；新文件出现旧类即失败', () => {
    const regressions: string[] = []
    for (const [path, src] of entries) {
      if (/\.test\.(ts|tsx)$/.test(path)) continue
      const key = normalizeKey(path)
      for (const [name, re] of Object.entries(LEGACY_PATTERNS)) {
        re.lastIndex = 0
        // hex 规则：白名单文件带有豁免标记时跳过，其他规则继续检查
        if (name === 'hex' && HEX_EXEMPT_FILES.has(key) && hasHexExemptMarker(src)) {
          continue
        }
        const count = (src.match(re) ?? []).length
        const allowed = LEGACY_SNAPSHOT[`${key}|${name}`] ?? 0
        if (count > allowed) {
          regressions.push(`${key} [${name}]: ${count} 处，快照上限 ${allowed} 处`)
        }
      }
    }
    expect(regressions).toEqual([])
  })
})
