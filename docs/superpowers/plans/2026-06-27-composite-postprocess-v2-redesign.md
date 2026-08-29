# Composite Postprocess V2 Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the composite postprocess module around folder-based background loading, global watermark presets, preset groups, channel-size output rules, and snapshot-based batch export.

**Architecture:** Add focused V2 composite domain modules under `src/features/composite/lib` first, then wire them into a reshaped `CompositeWorkspace`. Keep reusable Electron IPC and rendering pieces where they fit, but make export planning and preset management explicit and testable before UI work.

**Tech Stack:** React 19, TypeScript, Zustand persist, Vitest, Electron IPC, Canvas 2D, Tailwind CSS.

---

## Scope Check

The approved spec is large, but it is one coherent subsystem: the postprocess composite workspace. The plan is split into independently verifiable tasks. Each task should be committed before moving to the next task.

Existing dirty worktree note: before executing, inspect `git status --short`. The current workspace may contain unrelated edits in existing composite files. Do not revert or overwrite unrelated user changes. Prefer adding new focused V2 files first, then replacing old entry points only in the final integration tasks.

## File Structure

Create or reshape these files:

- `src/features/composite/lib/compositeV2Types.ts`: canonical V2 domain types.
- `src/features/composite/lib/compositeBackgrounds.ts`: background file filtering, relative-path handling, and natural sorting.
- `src/features/composite/lib/compositeOutputRulesV2.ts`: global rules, preset overrides, effective rule calculation.
- `src/features/composite/lib/compositePathTemplates.ts`: template variable replacement, filename sanitization, collision suffix planning.
- `src/features/composite/lib/compositePresetLibrary.ts`: pure preset and group operations.
- `src/features/composite/lib/compositeExportPlan.ts`: snapshot creation, export item expansion, count and index rules.
- `src/features/composite/lib/compositeRenderPlan.ts`: ratio branch decisions, fit-mode geometry, layer coordinate mapping.
- `src/features/composite/lib/compositeJpeg.ts`: JPG quality-search helpers.
- `src/features/composite/lib/compositeExportHistoryV2.ts`: persisted history retention and summaries.
- `src/features/composite/storeV2.ts`: Zustand store for batch state, preset state, runtime state, and history.
- `src/features/composite/components/BatchExportTab.tsx`: batch export page.
- `src/features/composite/components/PresetManagementTab.tsx`: preset management page.
- `src/features/composite/components/PresetCanvasEditor.tsx`: canvas-first editor.
- `src/features/composite/components/FloatingLogoLibrary.tsx`: floating logo library side panel.
- `src/features/composite/components/FloatingLayerToolbar.tsx`: floating layer creation toolbar.
- `src/features/composite/components/ExportResultsPanel.tsx`: progress, success, warnings, failures, history.
- `src/features/composite/CompositeWorkspace.tsx`: final tab shell and integration.
- `electron/ipc-handlers.ts`: add narrow filesystem helpers only when renderer-side logic cannot do the job.
- `electron/preload.ts` and `electron/preload.cjs`: expose new IPC helpers to the renderer.
- Tests beside the new logic modules, using `*.test.ts`.

Do not split the gallery or Agent modules. Do not migrate the old `src/storePostprocess.ts` model.

---

### Task 1: Add V2 Domain Types And Defaults

**Files:**
- Create: `src/features/composite/lib/compositeV2Types.ts`
- Create: `src/features/composite/lib/compositeV2Defaults.ts`
- Test: `src/features/composite/lib/compositeV2Types.test.ts`

- [ ] **Step 1: Write the failing type/default test**

Create `src/features/composite/lib/compositeV2Types.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createDefaultCompositeV2State } from './compositeV2Defaults'

describe('composite v2 defaults', () => {
  it('creates a 1280x720 default preset with jpg output defaults', () => {
    const state = createDefaultCompositeV2State()

    expect(state.presets[0]).toMatchObject({
      name: '默认产品预设',
      baseCanvas: { width: 1280, height: 720 },
      outputRootPath: '',
      useOutputOverrides: false,
    })
    expect(state.presets[0]?.layers).toEqual([])
    expect(state.globalFitMode).toBe('crop-fill')
    expect(state.historyRetention).toBe(10)
    expect(state.outputRuleGroups.map((group) => group.name)).toEqual(['广点通/头条', '百度', '厂商'])
    expect(state.outputRuleGroups[0]?.rules[0]).toMatchObject({
      name: '1280x720',
      width: 1280,
      height: 720,
      maxSizeKb: 399,
      format: 'jpg',
    })
  })
})
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- src/features/composite/lib/compositeV2Types.test.ts
```

Expected: fail because `compositeV2Defaults` does not exist.

- [ ] **Step 3: Add V2 types**

Create `src/features/composite/lib/compositeV2Types.ts`:

```ts
export type CompositeV2ImageFormat = 'jpg'

export type CompositeV2FitMode = 'crop-fill' | 'contain-blur' | 'stretch'

export type CompositeV2Anchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

export type CompositeV2Position =
  | {
      mode: 'anchor'
      anchor: CompositeV2Anchor
      marginX: number
      marginY: number
      offsetX: number
      offsetY: number
      width: number
      height: number
    }
  | {
      mode: 'free'
      x: number
      y: number
      width: number
      height: number
    }

export type CompositeV2Shadow = {
  enabled: boolean
  color: string
  x: number
  y: number
  blur: number
  opacity: number
}

export type CompositeV2LayerBase = {
  id: string
  name: string
  visible: boolean
  locked: boolean
  opacity: number
  rotation: number
  position: CompositeV2Position
  shadow: CompositeV2Shadow
}

export type CompositeV2ImageAssetRef =
  | { kind: 'path'; path: string }
  | { kind: 'internal'; path: string; originalPath?: string }

export type CompositeV2ImageLayer = CompositeV2LayerBase & {
  type: 'image'
  asset: CompositeV2ImageAssetRef | null
  radius: number
  clip: boolean
}

export type CompositeV2TextLayer = CompositeV2LayerBase & {
  type: 'text'
  text: string
  fontFamily: string
  fontSize: number
  fontWeight: number
  color: string
  align: 'left' | 'center' | 'right'
  lineHeight: number
  letterSpacing: number
  stroke: {
    enabled: boolean
    color: string
    width: number
  }
}

export type CompositeV2Layer = CompositeV2ImageLayer | CompositeV2TextLayer

export type CompositeV2OutputSizeRule = {
  id: string
  name: string
  enabled: boolean
  width: number
  height: number
  maxSizeKb: number
  format: CompositeV2ImageFormat
  subfolderTemplate: string
  filenameTemplate: string
}

export type CompositeV2OutputRuleGroup = {
  id: string
  name: string
  rules: CompositeV2OutputSizeRule[]
}

export type CompositeV2Preset = {
  id: string
  name: string
  outputRootPath: string
  baseCanvas: { width: number; height: number }
  sampleBackgroundPath: string
  layers: CompositeV2Layer[]
  useOutputOverrides: boolean
  outputRuleGroupsOverride: CompositeV2OutputRuleGroup[]
  updatedAt: number
}

export type CompositeV2PresetGroup = {
  id: string
  name: string
  presetIds: string[]
  updatedAt: number
}

export type CompositeV2BackgroundImage = {
  path: string
  name: string
  relativeDir: string
}

export type CompositeV2ExportStatus = 'idle' | 'running' | 'paused' | 'canceling' | 'completed' | 'canceled'

export type CompositeV2SuccessItem = {
  path: string
  presetId: string
  presetName: string
  channel: string
  size: string
  index: number
  warning?: string
}

export type CompositeV2FailureItem = {
  backgroundPath: string
  presetId: string
  presetName: string
  channel: string
  size: string
  reason: string
}

export type CompositeV2HistoryRecord = {
  id: string
  status: 'completed' | 'canceled' | 'completed-with-failures'
  startedAt: number
  endedAt: number
  backgroundFolder: string
  recursive: boolean
  backgroundCount: number
  presetGroupName: string
  enabledPresetCount: number
  plannedCount: number
  successCount: number
  failureCount: number
  successes: CompositeV2SuccessItem[]
  failures: CompositeV2FailureItem[]
  cleanup?: { deleted: string[]; failed: string[] }
}

export type CompositeV2State = {
  presets: CompositeV2Preset[]
  presetGroups: CompositeV2PresetGroup[]
  outputRuleGroups: CompositeV2OutputRuleGroup[]
  globalFitMode: CompositeV2FitMode
  historyRetention: number
  history: CompositeV2HistoryRecord[]
}
```

- [ ] **Step 4: Add defaults**

Create `src/features/composite/lib/compositeV2Defaults.ts`:

```ts
import type {
  CompositeV2OutputRuleGroup,
  CompositeV2OutputSizeRule,
  CompositeV2Preset,
  CompositeV2PresetGroup,
  CompositeV2State,
} from './compositeV2Types'

function rule(id: string, name: string, width: number, height: number, maxSizeKb: number): CompositeV2OutputSizeRule {
  return {
    id,
    name,
    enabled: false,
    width,
    height,
    maxSizeKb,
    format: 'jpg',
    subfolderTemplate: '{channel}/{size}',
    filenameTemplate: '{preset}-{source}-{index}',
  }
}

export function createDefaultCompositeV2OutputRuleGroups(): CompositeV2OutputRuleGroup[] {
  return [
    {
      id: 'gdt-toutiao',
      name: '广点通/头条',
      rules: [
        rule('gdt-toutiao-1280x720', '1280x720', 1280, 720, 399),
        rule('gdt-toutiao-1080x1920', '1080x1920', 1080, 1920, 399),
      ],
    },
    {
      id: 'baidu',
      name: '百度',
      rules: [
        rule('baidu-1140x640', '1140x640', 1140, 640, 299),
        rule('baidu-370x245', '370x245', 370, 245, 299),
        rule('baidu-1080x1920', '1080x1920', 1080, 1920, 399),
      ],
    },
    {
      id: 'vendor',
      name: '厂商',
      rules: [
        rule('vendor-1280x720', '1280x720', 1280, 720, 99),
        rule('vendor-1080x1920', '1080x1920', 1080, 1920, 99),
        rule('vendor-320x211', '320x211', 320, 211, 80),
        rule('vendor-320x210', '320x210', 320, 210, 80),
      ],
    },
  ]
}

export function createDefaultCompositeV2Preset(now = Date.now()): CompositeV2Preset {
  return {
    id: 'preset-default',
    name: '默认产品预设',
    outputRootPath: '',
    baseCanvas: { width: 1280, height: 720 },
    sampleBackgroundPath: '',
    layers: [],
    useOutputOverrides: false,
    outputRuleGroupsOverride: [],
    updatedAt: now,
  }
}

export function createDefaultCompositeV2PresetGroup(now = Date.now()): CompositeV2PresetGroup {
  return {
    id: 'group-default',
    name: '默认预设组',
    presetIds: ['preset-default'],
    updatedAt: now,
  }
}

export function createDefaultCompositeV2State(now = Date.now()): CompositeV2State {
  return {
    presets: [createDefaultCompositeV2Preset(now)],
    presetGroups: [createDefaultCompositeV2PresetGroup(now)],
    outputRuleGroups: createDefaultCompositeV2OutputRuleGroups(),
    globalFitMode: 'crop-fill',
    historyRetention: 10,
    history: [],
  }
}
```

- [ ] **Step 5: Run the test**

Run:

```bash
npm test -- src/features/composite/lib/compositeV2Types.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/features/composite/lib/compositeV2Types.ts src/features/composite/lib/compositeV2Defaults.ts src/features/composite/lib/compositeV2Types.test.ts
git commit -m "feat: add composite v2 domain defaults"
```

---

### Task 2: Background Loading Sort And Preview History Logic

**Files:**
- Create: `src/features/composite/lib/compositeBackgrounds.ts`
- Test: `src/features/composite/lib/compositeBackgrounds.test.ts`

- [ ] **Step 1: Write failing background tests**

Create `src/features/composite/lib/compositeBackgrounds.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createPreviewHistory, naturalSortBackgrounds, supportsCompositeBackground } from './compositeBackgrounds'
import type { CompositeV2BackgroundImage } from './compositeV2Types'

const image = (path: string, relativeDir = ''): CompositeV2BackgroundImage => ({
  path,
  name: path.split(/[\\/]/).pop() ?? path,
  relativeDir,
})

describe('composite backgrounds', () => {
  it('accepts supported image extensions only', () => {
    expect(supportsCompositeBackground('a.JPG')).toBe(true)
    expect(supportsCompositeBackground('a.jpeg')).toBe(true)
    expect(supportsCompositeBackground('a.png')).toBe(true)
    expect(supportsCompositeBackground('a.webp')).toBe(true)
    expect(supportsCompositeBackground('a.gif')).toBe(false)
  })

  it('sorts non-recursive backgrounds by natural filename', () => {
    const sorted = naturalSortBackgrounds([
      image('D:/bg/10.jpg'),
      image('D:/bg/2.jpg'),
      image('D:/bg/1.jpg'),
    ])

    expect(sorted.map((item) => item.name)).toEqual(['1.jpg', '2.jpg', '10.jpg'])
  })

  it('sorts recursive backgrounds by folder then filename', () => {
    const sorted = naturalSortBackgrounds([
      image('D:/bg/B/1.jpg', 'B'),
      image('D:/bg/A/10.jpg', 'A'),
      image('D:/bg/A/2.jpg', 'A'),
      image('D:/bg/A/sub/1.jpg', 'A/sub'),
    ])

    expect(sorted.map((item) => `${item.relativeDir}/${item.name}`)).toEqual([
      'A/2.jpg',
      'A/10.jpg',
      'A/sub/1.jpg',
      'B/1.jpg',
    ])
  })

  it('keeps preview navigation inside visited random backgrounds', () => {
    const history = createPreviewHistory(['a', 'b', 'c'])
    expect(history.current()).toBe('a')
    expect(history.push('c').current()).toBe('c')
    expect(history.previous().current()).toBe('a')
    expect(history.next().current()).toBe('c')
  })
})
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
npm test -- src/features/composite/lib/compositeBackgrounds.test.ts
```

Expected: fail because `compositeBackgrounds` does not exist.

- [ ] **Step 3: Implement background helpers**

Create `src/features/composite/lib/compositeBackgrounds.ts`:

```ts
import type { CompositeV2BackgroundImage } from './compositeV2Types'

const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function supportsCompositeBackground(path: string): boolean {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return false
  return SUPPORTED_EXTENSIONS.has(path.slice(dot).toLowerCase())
}

export function normalizeCompositeRelativeDir(relativeDir: string): string {
  return relativeDir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

export function naturalSortBackgrounds(items: CompositeV2BackgroundImage[]): CompositeV2BackgroundImage[] {
  return [...items].sort((a, b) => {
    const folderCompare = collator.compare(normalizeCompositeRelativeDir(a.relativeDir), normalizeCompositeRelativeDir(b.relativeDir))
    if (folderCompare !== 0) return folderCompare
    return collator.compare(a.name, b.name)
  })
}

export function createPreviewHistory(initial: string[] = []) {
  let entries = initial.slice(0, 1)
  let index = entries.length ? 0 : -1

  return {
    current() {
      return index >= 0 ? entries[index] : null
    },
    push(path: string) {
      entries = entries.slice(0, index + 1)
      entries.push(path)
      index = entries.length - 1
      return this
    },
    previous() {
      if (index > 0) index -= 1
      return this
    },
    next() {
      if (index < entries.length - 1) index += 1
      return this
    },
    snapshot() {
      return { entries: [...entries], index }
    },
  }
}
```

- [ ] **Step 4: Run the tests**

Run:

```bash
npm test -- src/features/composite/lib/compositeBackgrounds.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/features/composite/lib/compositeBackgrounds.ts src/features/composite/lib/compositeBackgrounds.test.ts
git commit -m "feat: add composite background ordering"
```

---

### Task 3: Output Rule Overrides And Path Templates

**Files:**
- Create: `src/features/composite/lib/compositeOutputRulesV2.ts`
- Create: `src/features/composite/lib/compositePathTemplates.ts`
- Test: `src/features/composite/lib/compositeOutputRulesV2.test.ts`
- Test: `src/features/composite/lib/compositePathTemplates.test.ts`

- [ ] **Step 1: Write output rule tests**

Create `src/features/composite/lib/compositeOutputRulesV2.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createDefaultCompositeV2OutputRuleGroups } from './compositeV2Defaults'
import { getEffectiveOutputRuleGroups, getEnabledOutputRules } from './compositeOutputRulesV2'
import type { CompositeV2Preset } from './compositeV2Types'

function presetWithOverride(useOutputOverrides: boolean, override = createDefaultCompositeV2OutputRuleGroups()): Pick<CompositeV2Preset, 'useOutputOverrides' | 'outputRuleGroupsOverride'> {
  return { useOutputOverrides, outputRuleGroupsOverride: override }
}

describe('composite v2 output rules', () => {
  it('uses global output rules when preset override is disabled', () => {
    const global = createDefaultCompositeV2OutputRuleGroups()
    global[0]!.rules[0]!.enabled = true

    const effective = getEffectiveOutputRuleGroups(presetWithOverride(false), global)

    expect(effective[0]?.rules[0]?.enabled).toBe(true)
  })

  it('uses preset output rules when override is enabled', () => {
    const global = createDefaultCompositeV2OutputRuleGroups()
    global[0]!.rules[0]!.enabled = true
    const override = createDefaultCompositeV2OutputRuleGroups()
    override[1]!.rules[1]!.enabled = true
    override[1]!.rules[1]!.maxSizeKb = 123

    const enabled = getEnabledOutputRules(getEffectiveOutputRuleGroups(presetWithOverride(true, override), global))

    expect(enabled).toHaveLength(1)
    expect(enabled[0]).toMatchObject({ channelName: '百度', name: '370x245', maxSizeKb: 123 })
  })
})
```

- [ ] **Step 2: Write path template tests**

Create `src/features/composite/lib/compositePathTemplates.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildCompositeOutputPathParts, sanitizePathSegment, withCollisionSuffix } from './compositePathTemplates'

describe('composite path templates', () => {
  it('replaces output variables and sanitizes path segments', () => {
    const parts = buildCompositeOutputPathParts({
      date: '20260627',
      channel: '百度',
      size: '1080x1920',
      preset: '产品:A',
      index: 3,
      source: '背景/1',
      sourceDir: 'A/B',
      custom: '投放1',
      subfolderTemplate: '{channel}/{size}/{custom}',
      filenameTemplate: '{preset}-{source}-{index}',
      preserveSourceDir: true,
    })

    expect(parts).toEqual({
      dateFolder: '20260627',
      subfolders: ['百度', '1080x1920', '投放1', 'A', 'B'],
      filename: '产品_A-背景_1-3.jpg',
    })
  })

  it('sanitizes reserved filename characters', () => {
    expect(sanitizePathSegment('a:b*c?d<e>f|g')).toBe('a_b_c_d_e_f_g')
  })

  it('appends collision suffix before extension', () => {
    expect(withCollisionSuffix('image.jpg', 2)).toBe('image-2.jpg')
  })
})
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
npm test -- src/features/composite/lib/compositeOutputRulesV2.test.ts src/features/composite/lib/compositePathTemplates.test.ts
```

Expected: fail because helpers do not exist.

- [ ] **Step 4: Implement output rules**

Create `src/features/composite/lib/compositeOutputRulesV2.ts`:

```ts
import type { CompositeV2OutputRuleGroup, CompositeV2OutputSizeRule, CompositeV2Preset } from './compositeV2Types'

export type CompositeV2EnabledOutputRule = CompositeV2OutputSizeRule & {
  channelId: string
  channelName: string
}

export function getEffectiveOutputRuleGroups(
  preset: Pick<CompositeV2Preset, 'useOutputOverrides' | 'outputRuleGroupsOverride'>,
  globalGroups: CompositeV2OutputRuleGroup[],
): CompositeV2OutputRuleGroup[] {
  return preset.useOutputOverrides && preset.outputRuleGroupsOverride.length
    ? preset.outputRuleGroupsOverride
    : globalGroups
}

export function getEnabledOutputRules(groups: CompositeV2OutputRuleGroup[]): CompositeV2EnabledOutputRule[] {
  return groups.flatMap((group) => group.rules
    .filter((rule) => rule.enabled)
    .map((rule) => ({ ...rule, channelId: group.id, channelName: group.name })))
}
```

- [ ] **Step 5: Implement path templates**

Create `src/features/composite/lib/compositePathTemplates.ts`:

```ts
type TemplateVars = {
  date: string
  channel: string
  size: string
  preset: string
  index: number
  source: string
  sourceDir: string
  custom: string
}

type BuildPathInput = TemplateVars & {
  subfolderTemplate: string
  filenameTemplate: string
  preserveSourceDir: boolean
}

const RESERVED_CHARS = /[<>:"/\\|?*\u0000-\u001F]/g

export function sanitizePathSegment(value: string): string {
  return value.replace(RESERVED_CHARS, '_').trim() || '_'
}

function replaceTemplate(template: string, vars: TemplateVars): string {
  return template
    .replaceAll('{date}', vars.date)
    .replaceAll('{channel}', vars.channel)
    .replaceAll('{size}', vars.size)
    .replaceAll('{preset}', vars.preset)
    .replaceAll('{index}', String(vars.index))
    .replaceAll('{source}', vars.source)
    .replaceAll('{sourceDir}', vars.sourceDir)
    .replaceAll('{custom}', vars.custom)
}

function splitTemplatePath(value: string): string[] {
  return value
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => sanitizePathSegment(part))
    .filter(Boolean)
}

export function buildCompositeOutputPathParts(input: BuildPathInput) {
  const subfolders = splitTemplatePath(replaceTemplate(input.subfolderTemplate, input))
  if (input.preserveSourceDir && input.sourceDir) {
    subfolders.push(...splitTemplatePath(input.sourceDir))
  }
  const filenameStem = sanitizePathSegment(replaceTemplate(input.filenameTemplate, input))
  return {
    dateFolder: sanitizePathSegment(input.date),
    subfolders,
    filename: `${filenameStem}.jpg`,
  }
}

export function withCollisionSuffix(filename: string, suffix: number): string {
  const dot = filename.lastIndexOf('.')
  if (dot < 0) return `${filename}-${suffix}`
  return `${filename.slice(0, dot)}-${suffix}${filename.slice(dot)}`
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm test -- src/features/composite/lib/compositeOutputRulesV2.test.ts src/features/composite/lib/compositePathTemplates.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/features/composite/lib/compositeOutputRulesV2.ts src/features/composite/lib/compositeOutputRulesV2.test.ts src/features/composite/lib/compositePathTemplates.ts src/features/composite/lib/compositePathTemplates.test.ts
git commit -m "feat: add composite output rule planning"
```

---

### Task 4: Preset Library And Group Operations

**Files:**
- Create: `src/features/composite/lib/compositePresetLibrary.ts`
- Test: `src/features/composite/lib/compositePresetLibrary.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/features/composite/lib/compositePresetLibrary.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createDefaultCompositeV2Preset, createDefaultCompositeV2PresetGroup } from './compositeV2Defaults'
import { addPresetToGroup, duplicatePresetIntoGroup, filterPresetsForLibrary, movePresetInGroup } from './compositePresetLibrary'

describe('composite preset library', () => {
  it('adds a global preset reference to a group once', () => {
    const group = createDefaultCompositeV2PresetGroup(1)
    expect(addPresetToGroup(group, 'preset-default').presetIds).toEqual(['preset-default'])
    expect(addPresetToGroup(group, 'preset-2').presetIds).toEqual(['preset-default', 'preset-2'])
  })

  it('duplicates a global preset and adds the copy to the current group', () => {
    const preset = createDefaultCompositeV2Preset(1)
    const group = createDefaultCompositeV2PresetGroup(1)

    const result = duplicatePresetIntoGroup([preset], group, preset.id, 'preset-copy', 2)

    expect(result.presets).toHaveLength(2)
    expect(result.presets[1]).toMatchObject({ id: 'preset-copy', name: '默认产品预设 副本', updatedAt: 2 })
    expect(result.presets[1]).not.toBe(preset)
    expect(result.group.presetIds).toEqual(['preset-default', 'preset-copy'])
  })

  it('reorders group preset ids', () => {
    const group = { ...createDefaultCompositeV2PresetGroup(1), presetIds: ['a', 'b', 'c'] }
    expect(movePresetInGroup(group, 'c', 0).presetIds).toEqual(['c', 'a', 'b'])
  })

  it('filters presets by name and group membership', () => {
    const presets = [
      { ...createDefaultCompositeV2Preset(1), id: 'a', name: '百度产品' },
      { ...createDefaultCompositeV2Preset(2), id: 'b', name: '厂商产品' },
    ]
    const groups = [{ ...createDefaultCompositeV2PresetGroup(1), id: 'g1', presetIds: ['b'] }]

    expect(filterPresetsForLibrary(presets, groups, { query: '产品', groupId: 'g1' }).map((preset) => preset.id)).toEqual(['b'])
  })
})
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
npm test -- src/features/composite/lib/compositePresetLibrary.test.ts
```

Expected: fail because helper file does not exist.

- [ ] **Step 3: Implement library operations**

Create `src/features/composite/lib/compositePresetLibrary.ts`:

```ts
import type { CompositeV2Preset, CompositeV2PresetGroup } from './compositeV2Types'

export function addPresetToGroup(group: CompositeV2PresetGroup, presetId: string): CompositeV2PresetGroup {
  if (group.presetIds.includes(presetId)) return group
  return { ...group, presetIds: [...group.presetIds, presetId], updatedAt: Date.now() }
}

export function movePresetInGroup(group: CompositeV2PresetGroup, presetId: string, targetIndex: number): CompositeV2PresetGroup {
  const currentIndex = group.presetIds.indexOf(presetId)
  if (currentIndex < 0) return group
  const presetIds = [...group.presetIds]
  const [item] = presetIds.splice(currentIndex, 1)
  presetIds.splice(Math.max(0, Math.min(targetIndex, presetIds.length)), 0, item)
  return { ...group, presetIds, updatedAt: Date.now() }
}

export function duplicatePresetIntoGroup(
  presets: CompositeV2Preset[],
  group: CompositeV2PresetGroup,
  sourcePresetId: string,
  newPresetId: string,
  now = Date.now(),
) {
  const source = presets.find((preset) => preset.id === sourcePresetId)
  if (!source) return { presets, group }
  const copy: CompositeV2Preset = {
    ...structuredClone(source),
    id: newPresetId,
    name: `${source.name} 副本`,
    updatedAt: now,
  }
  return {
    presets: [...presets, copy],
    group: { ...group, presetIds: [...group.presetIds, copy.id], updatedAt: now },
  }
}

export function filterPresetsForLibrary(
  presets: CompositeV2Preset[],
  groups: CompositeV2PresetGroup[],
  filters: { query?: string; groupId?: string },
) {
  const query = filters.query?.trim().toLowerCase()
  const group = filters.groupId ? groups.find((item) => item.id === filters.groupId) : null
  return presets
    .filter((preset) => !query || preset.name.toLowerCase().includes(query))
    .filter((preset) => !group || group.presetIds.includes(preset.id))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- src/features/composite/lib/compositePresetLibrary.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/features/composite/lib/compositePresetLibrary.ts src/features/composite/lib/compositePresetLibrary.test.ts
git commit -m "feat: add composite preset library helpers"
```

---

### Task 5: Export Snapshot And Item Expansion

**Files:**
- Create: `src/features/composite/lib/compositeExportPlan.ts`
- Test: `src/features/composite/lib/compositeExportPlan.test.ts`

- [ ] **Step 1: Write failing export plan tests**

Create `src/features/composite/lib/compositeExportPlan.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createDefaultCompositeV2OutputRuleGroups, createDefaultCompositeV2Preset, createDefaultCompositeV2PresetGroup } from './compositeV2Defaults'
import { createCompositeExportSnapshot, expandCompositeExportItems } from './compositeExportPlan'
import type { CompositeV2BackgroundImage } from './compositeV2Types'

const backgrounds: CompositeV2BackgroundImage[] = [
  { path: 'D:/bg/a.jpg', name: 'a.jpg', relativeDir: '' },
  { path: 'D:/bg/b.jpg', name: 'b.jpg', relativeDir: '' },
]

describe('composite export plan', () => {
  it('expands items per preset and per enabled channel-size rule', () => {
    const outputRuleGroups = createDefaultCompositeV2OutputRuleGroups()
    outputRuleGroups[0]!.rules[0]!.enabled = true
    outputRuleGroups[1]!.rules[2]!.enabled = true
    const presetA = { ...createDefaultCompositeV2Preset(1), id: 'a', name: 'A' }
    const presetB = { ...createDefaultCompositeV2Preset(1), id: 'b', name: 'B' }
    const group = { ...createDefaultCompositeV2PresetGroup(1), presetIds: ['a', 'b'] }

    const snapshot = createCompositeExportSnapshot({
      id: 'job-1',
      date: '20260627',
      backgroundFolder: 'D:/bg',
      recursive: false,
      backgrounds,
      presets: [presetA, presetB],
      presetGroup: group,
      enabledPresetIds: ['a', 'b'],
      outputRuleGroups,
      custom: 'x',
      fitMode: 'crop-fill',
      preserveSourceDir: false,
    })
    const items = expandCompositeExportItems(snapshot)

    expect(items).toHaveLength(8)
    expect(items.filter((item) => item.preset.id === 'a' && item.outputRule.name === '1280x720').map((item) => item.index)).toEqual([1, 2])
    expect(items.filter((item) => item.preset.id === 'a' && item.outputRule.name === '1080x1920').map((item) => item.index)).toEqual([1, 2])
  })

  it('freezes presets inside the snapshot', () => {
    const outputRuleGroups = createDefaultCompositeV2OutputRuleGroups()
    outputRuleGroups[0]!.rules[0]!.enabled = true
    const preset = { ...createDefaultCompositeV2Preset(1), id: 'a', name: 'Before' }
    const group = { ...createDefaultCompositeV2PresetGroup(1), presetIds: ['a'] }

    const snapshot = createCompositeExportSnapshot({
      id: 'job-1',
      date: '20260627',
      backgroundFolder: 'D:/bg',
      recursive: false,
      backgrounds,
      presets: [preset],
      presetGroup: group,
      enabledPresetIds: ['a'],
      outputRuleGroups,
      custom: '',
      fitMode: 'crop-fill',
      preserveSourceDir: false,
    })
    preset.name = 'After'

    expect(snapshot.presets[0]?.name).toBe('Before')
  })
})
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
npm test -- src/features/composite/lib/compositeExportPlan.test.ts
```

Expected: fail because planner does not exist.

- [ ] **Step 3: Implement snapshot and expansion**

Create `src/features/composite/lib/compositeExportPlan.ts`:

```ts
import { getEffectiveOutputRuleGroups, getEnabledOutputRules, type CompositeV2EnabledOutputRule } from './compositeOutputRulesV2'
import type {
  CompositeV2BackgroundImage,
  CompositeV2FitMode,
  CompositeV2OutputRuleGroup,
  CompositeV2Preset,
  CompositeV2PresetGroup,
} from './compositeV2Types'

export type CompositeV2ExportSnapshotInput = {
  id: string
  date: string
  backgroundFolder: string
  recursive: boolean
  backgrounds: CompositeV2BackgroundImage[]
  presets: CompositeV2Preset[]
  presetGroup: CompositeV2PresetGroup
  enabledPresetIds: string[]
  outputRuleGroups: CompositeV2OutputRuleGroup[]
  custom: string
  fitMode: CompositeV2FitMode
  preserveSourceDir: boolean
}

export type CompositeV2ExportSnapshot = CompositeV2ExportSnapshotInput & {
  createdAt: number
}

export type CompositeV2ExportItem = {
  snapshotId: string
  background: CompositeV2BackgroundImage
  preset: CompositeV2Preset
  outputRule: CompositeV2EnabledOutputRule
  index: number
  date: string
  custom: string
}

export function createCompositeExportSnapshot(input: CompositeV2ExportSnapshotInput, now = Date.now()): CompositeV2ExportSnapshot {
  return structuredClone({ ...input, createdAt: now })
}

export function expandCompositeExportItems(snapshot: CompositeV2ExportSnapshot): CompositeV2ExportItem[] {
  const presetsById = new Map(snapshot.presets.map((preset) => [preset.id, preset]))
  const enabledPresetSet = new Set(snapshot.enabledPresetIds)
  const orderedPresets = snapshot.presetGroup.presetIds
    .filter((presetId) => enabledPresetSet.has(presetId))
    .map((presetId) => presetsById.get(presetId))
    .filter((preset): preset is CompositeV2Preset => Boolean(preset))

  return orderedPresets.flatMap((preset) => {
    const rules = getEnabledOutputRules(getEffectiveOutputRuleGroups(preset, snapshot.outputRuleGroups))
    return rules.flatMap((rule) => snapshot.backgrounds.map((background, backgroundIndex) => ({
      snapshotId: snapshot.id,
      background,
      preset,
      outputRule: rule,
      index: backgroundIndex + 1,
      date: snapshot.date,
      custom: snapshot.custom,
    })))
  })
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- src/features/composite/lib/compositeExportPlan.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/features/composite/lib/compositeExportPlan.ts src/features/composite/lib/compositeExportPlan.test.ts
git commit -m "feat: add composite export snapshot planning"
```

---

### Task 6: Render Plan Geometry And Layer Mapping

**Files:**
- Create: `src/features/composite/lib/compositeRenderPlan.ts`
- Test: `src/features/composite/lib/compositeRenderPlan.test.ts`

- [ ] **Step 1: Write failing render plan tests**

Create `src/features/composite/lib/compositeRenderPlan.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { chooseRenderBranch, mapLayerPositionToCanvas, planBackgroundFit } from './compositeRenderPlan'

describe('composite render plan', () => {
  it('uses source-first rendering for matching ratios', () => {
    expect(chooseRenderBranch({ width: 1280, height: 720 }, { width: 1920, height: 1080 })).toBe('source-first')
  })

  it('uses target-first rendering for non-matching ratios', () => {
    expect(chooseRenderBranch({ width: 1280, height: 720 }, { width: 1080, height: 1920 })).toBe('target-first')
  })

  it('plans crop fill geometry', () => {
    expect(planBackgroundFit('crop-fill', { width: 1000, height: 500 }, { width: 300, height: 300 })).toMatchObject({
      sx: 250,
      sy: 0,
      sw: 500,
      sh: 500,
      dx: 0,
      dy: 0,
      dw: 300,
      dh: 300,
    })
  })

  it('maps free position from base canvas to target canvas', () => {
    expect(mapLayerPositionToCanvas(
      { mode: 'free', x: 128, y: 72, width: 256, height: 144 },
      { width: 1280, height: 720 },
      { width: 640, height: 360 },
    )).toEqual({ x: 64, y: 36, width: 128, height: 72 })
  })
})
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
npm test -- src/features/composite/lib/compositeRenderPlan.test.ts
```

Expected: fail because helper file does not exist.

- [ ] **Step 3: Implement render planning**

Create `src/features/composite/lib/compositeRenderPlan.ts`:

```ts
import type { CompositeV2FitMode, CompositeV2Position } from './compositeV2Types'

type Size = { width: number; height: number }

export type CompositeV2RenderBranch = 'source-first' | 'target-first'

export type CompositeV2DrawRect = {
  sx: number
  sy: number
  sw: number
  sh: number
  dx: number
  dy: number
  dw: number
  dh: number
}

export function chooseRenderBranch(source: Size, target: Size, tolerance = 0.001): CompositeV2RenderBranch {
  const sourceRatio = source.width / source.height
  const targetRatio = target.width / target.height
  return Math.abs(sourceRatio - targetRatio) <= tolerance ? 'source-first' : 'target-first'
}

export function planBackgroundFit(mode: CompositeV2FitMode, source: Size, target: Size): CompositeV2DrawRect {
  if (mode === 'stretch') {
    return { sx: 0, sy: 0, sw: source.width, sh: source.height, dx: 0, dy: 0, dw: target.width, dh: target.height }
  }
  const scale = mode === 'crop-fill'
    ? Math.max(target.width / source.width, target.height / source.height)
    : Math.min(target.width / source.width, target.height / source.height)
  const dw = source.width * scale
  const dh = source.height * scale
  if (mode === 'contain-blur') {
    return { sx: 0, sy: 0, sw: source.width, sh: source.height, dx: (target.width - dw) / 2, dy: (target.height - dh) / 2, dw, dh }
  }
  const sw = target.width / scale
  const sh = target.height / scale
  return { sx: (source.width - sw) / 2, sy: (source.height - sh) / 2, sw, sh, dx: 0, dy: 0, dw: target.width, dh: target.height }
}

export function mapLayerPositionToCanvas(position: CompositeV2Position, base: Size, target: Size) {
  const scaleX = target.width / base.width
  const scaleY = target.height / base.height
  if (position.mode === 'free') {
    return {
      x: position.x * scaleX,
      y: position.y * scaleY,
      width: position.width * scaleX,
      height: position.height * scaleY,
    }
  }
  const width = position.width * scaleX
  const height = position.height * scaleY
  const marginX = position.marginX * scaleX
  const marginY = position.marginY * scaleY
  const offsetX = position.offsetX * scaleX
  const offsetY = position.offsetY * scaleY
  const [vertical, horizontal] = position.anchor.split('-') as [string, string | undefined]
  const h = horizontal ?? vertical
  const v = horizontal ? vertical : 'center'
  const x = h === 'left' ? marginX : h === 'right' ? target.width - width - marginX : (target.width - width) / 2
  const y = v === 'top' ? marginY : v === 'bottom' ? target.height - height - marginY : (target.height - height) / 2
  return { x: x + offsetX, y: y + offsetY, width, height }
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- src/features/composite/lib/compositeRenderPlan.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/features/composite/lib/compositeRenderPlan.ts src/features/composite/lib/compositeRenderPlan.test.ts
git commit -m "feat: add composite render planning"
```

---

### Task 7: JPG Quality Search And History Retention

**Files:**
- Create: `src/features/composite/lib/compositeJpeg.ts`
- Create: `src/features/composite/lib/compositeExportHistoryV2.ts`
- Test: `src/features/composite/lib/compositeJpeg.test.ts`
- Test: `src/features/composite/lib/compositeExportHistoryV2.test.ts`

- [ ] **Step 1: Write JPG tests**

Create `src/features/composite/lib/compositeJpeg.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { chooseJpegQuality } from './compositeJpeg'

describe('composite jpg quality', () => {
  it('chooses the highest quality that fits max KB', () => {
    const result = chooseJpegQuality({
      maxSizeKb: 100,
      estimateSizeKb: (quality) => quality >= 0.8 ? 120 : 90,
    })

    expect(result.warning).toBeUndefined()
    expect(result.quality).toBeLessThan(0.8)
    expect(result.quality).toBeGreaterThanOrEqual(0.5)
  })

  it('returns quality 0.5 with warning when minimum still exceeds max KB', () => {
    const result = chooseJpegQuality({
      maxSizeKb: 100,
      estimateSizeKb: () => 150,
    })

    expect(result).toEqual({
      quality: 0.5,
      warning: '最低质量 0.5 仍超过 100KB',
    })
  })
})
```

- [ ] **Step 2: Write history tests**

Create `src/features/composite/lib/compositeExportHistoryV2.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { addCompositeHistoryRecord } from './compositeExportHistoryV2'
import type { CompositeV2HistoryRecord } from './compositeV2Types'

const record = (id: string, endedAt: number): CompositeV2HistoryRecord => ({
  id,
  status: 'completed',
  startedAt: endedAt - 1,
  endedAt,
  backgroundFolder: 'D:/bg',
  recursive: false,
  backgroundCount: 1,
  presetGroupName: '组',
  enabledPresetCount: 1,
  plannedCount: 1,
  successCount: 1,
  failureCount: 0,
  successes: [],
  failures: [],
})

describe('composite export history v2', () => {
  it('keeps the newest records within retention count', () => {
    const history = addCompositeHistoryRecord([record('a', 1), record('b', 2)], record('c', 3), 2)

    expect(history.map((item) => item.id)).toEqual(['c', 'b'])
  })
})
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
npm test -- src/features/composite/lib/compositeJpeg.test.ts src/features/composite/lib/compositeExportHistoryV2.test.ts
```

Expected: fail because files do not exist.

- [ ] **Step 4: Implement JPG helper**

Create `src/features/composite/lib/compositeJpeg.ts`:

```ts
export type ChooseJpegQualityInput = {
  maxSizeKb: number
  minQuality?: number
  maxQuality?: number
  iterations?: number
  estimateSizeKb: (quality: number) => number
}

export function chooseJpegQuality(input: ChooseJpegQualityInput) {
  const minQuality = input.minQuality ?? 0.5
  const maxQuality = input.maxQuality ?? 0.9
  const iterations = input.iterations ?? 8
  if (input.estimateSizeKb(minQuality) > input.maxSizeKb) {
    return { quality: minQuality, warning: `最低质量 ${minQuality} 仍超过 ${input.maxSizeKb}KB` }
  }
  let low = minQuality
  let high = maxQuality
  let best = minQuality
  for (let i = 0; i < iterations; i += 1) {
    const mid = (low + high) / 2
    if (input.estimateSizeKb(mid) <= input.maxSizeKb) {
      best = mid
      low = mid
    } else {
      high = mid
    }
  }
  return { quality: Number(best.toFixed(4)) }
}
```

- [ ] **Step 5: Implement history helper**

Create `src/features/composite/lib/compositeExportHistoryV2.ts`:

```ts
import type { CompositeV2HistoryRecord } from './compositeV2Types'

export function addCompositeHistoryRecord(
  history: CompositeV2HistoryRecord[],
  record: CompositeV2HistoryRecord,
  retention: number,
): CompositeV2HistoryRecord[] {
  return [record, ...history]
    .sort((a, b) => b.endedAt - a.endedAt)
    .slice(0, Math.max(1, retention))
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm test -- src/features/composite/lib/compositeJpeg.test.ts src/features/composite/lib/compositeExportHistoryV2.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/features/composite/lib/compositeJpeg.ts src/features/composite/lib/compositeJpeg.test.ts src/features/composite/lib/compositeExportHistoryV2.ts src/features/composite/lib/compositeExportHistoryV2.test.ts
git commit -m "feat: add composite export quality and history helpers"
```

---

### Task 8: Electron Filesystem Helpers For Recursive Listing And Cleanup

**Files:**
- Modify: `electron/ipc-handlers.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/preload.cjs`
- Test: no unit test required for Electron IPC; verify with build and manual smoke.

- [ ] **Step 1: Inspect current preload API**

Run:

```bash
rg -n "composite:|fs:" electron src/vite-env.d.ts src
```

Expected: see existing composite image read/list/save APIs and preload type exposure locations.

- [ ] **Step 2: Add IPC handlers**

In `electron/ipc-handlers.ts`, add these narrow handlers near existing composite handlers:

```ts
function listCompositeImageFilesRecursive(dirPath: string, rootPath = dirPath) {
  const safeDirPath = assertAllowedPath(dirPath)
  if (!existsSync(safeDirPath) || !statSync(safeDirPath).isDirectory()) return []
  return readdirSync(safeDirPath)
    .flatMap((name) => {
      const filePath = path.join(safeDirPath, name)
      try {
        const stat = statSync(filePath)
        if (stat.isDirectory()) return listCompositeImageFilesRecursive(filePath, rootPath)
        if (!stat.isFile() || !isCompositeImagePath(filePath)) return []
        const relativeDir = path.relative(rootPath, path.dirname(filePath))
        return [{
          path: filePath,
          name: path.basename(filePath),
          relativeDir,
        }]
      } catch {
        return []
      }
    })
}
```

Then register:

```ts
ipcMain.handle('composite:list-background-files', async (_event, { dirPath, recursive }: { dirPath: string; recursive: boolean }) => {
  try {
    const safeDirPath = assertAllowedPath(dirPath)
    const files = recursive
      ? listCompositeImageFilesRecursive(safeDirPath)
      : listCompositeImageFiles(safeDirPath).map((file) => ({ path: file.path, name: file.name, relativeDir: '' }))
    return files
  } catch (err) {
    console.error('列出后期处理背景图失败:', err)
    return []
  }
})

ipcMain.handle('composite:delete-files', async (_event, { filePaths }: { filePaths: string[] }) => {
  const deleted: string[] = []
  const failed: string[] = []
  for (const filePath of filePaths) {
    try {
      const safeFilePath = assertAllowedPath(filePath)
      if (existsSync(safeFilePath)) unlinkSync(safeFilePath)
      deleted.push(safeFilePath)
    } catch {
      failed.push(filePath)
    }
  }
  return { deleted, failed }
})
```

- [ ] **Step 3: Expose the IPC calls in preload**

In `electron/preload.ts` and `electron/preload.cjs`, expose:

```ts
listCompositeBackgroundFiles: (dirPath: string, recursive: boolean) =>
  ipcRenderer.invoke('composite:list-background-files', { dirPath, recursive }),
deleteCompositeFiles: (filePaths: string[]) =>
  ipcRenderer.invoke('composite:delete-files', { filePaths }),
```

Use the existing preload style in the repository. Do not rename existing APIs.

- [ ] **Step 4: Add or update renderer typings**

Find the existing electron API type declaration:

```bash
rg -n "listComposite|readComposite|saveComposite|electronAPI" src electron
```

Add signatures:

```ts
listCompositeBackgroundFiles?: (dirPath: string, recursive: boolean) => Promise<Array<{ path: string; name: string; relativeDir: string }>>
deleteCompositeFiles?: (filePaths: string[]) => Promise<{ deleted: string[]; failed: string[] }>
```

- [ ] **Step 5: Build**

Run:

```bash
npm run build
```

Expected: TypeScript and Vite build pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add electron/ipc-handlers.ts electron/preload.ts electron/preload.cjs src/vite-env.d.ts
git commit -m "feat: add composite background filesystem IPC"
```

---

### Task 9: Add V2 Store With Persisted Presets And History

**Files:**
- Create: `src/features/composite/storeV2.ts`
- Test: `src/features/composite/storeV2.test.ts`

- [ ] **Step 1: Write store behavior tests**

Create `src/features/composite/storeV2.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createCompositeV2StoreState } from './storeV2'

describe('composite v2 store state factory', () => {
  it('creates batch state separate from persisted preset state', () => {
    const state = createCompositeV2StoreState()

    expect(state.backgroundFolder).toBe('')
    expect(state.recursiveBackgrounds).toBe(false)
    expect(state.customValue).toBe('')
    expect(state.presets.length).toBeGreaterThan(0)
    expect(state.historyRetention).toBe(10)
    expect(state.exportStatus).toBe('idle')
  })
})
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npm test -- src/features/composite/storeV2.test.ts
```

Expected: fail because `storeV2` does not exist.

- [ ] **Step 3: Implement store**

Create `src/features/composite/storeV2.ts`:

```ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createDefaultCompositeV2State } from './lib/compositeV2Defaults'
import type {
  CompositeV2BackgroundImage,
  CompositeV2ExportStatus,
  CompositeV2HistoryRecord,
  CompositeV2OutputRuleGroup,
  CompositeV2Preset,
  CompositeV2PresetGroup,
} from './lib/compositeV2Types'

export type CompositeV2StoreState = {
  backgroundFolder: string
  recursiveBackgrounds: boolean
  backgrounds: CompositeV2BackgroundImage[]
  previewHistory: string[]
  previewHistoryIndex: number
  selectedPresetGroupId: string
  selectedPreviewPresetId: string
  enabledPresetIdsForRun: string[]
  customValue: string
  preserveSourceDir: boolean
  exportStatus: CompositeV2ExportStatus
  exportCompleted: number
  exportTotal: number
  presets: CompositeV2Preset[]
  presetGroups: CompositeV2PresetGroup[]
  outputRuleGroups: CompositeV2OutputRuleGroup[]
  globalFitMode: ReturnType<typeof createDefaultCompositeV2State>['globalFitMode']
  historyRetention: number
  history: CompositeV2HistoryRecord[]
  setBackgroundFolder: (path: string) => void
  setBackgrounds: (backgrounds: CompositeV2BackgroundImage[]) => void
  setSelectedPresetGroup: (groupId: string) => void
  setEnabledPresetIdsForRun: (presetIds: string[]) => void
  setExportProgress: (completed: number, total: number) => void
  setExportStatus: (status: CompositeV2ExportStatus) => void
}

export function createCompositeV2StoreState(): Omit<
  CompositeV2StoreState,
  'setBackgroundFolder' | 'setBackgrounds' | 'setSelectedPresetGroup' | 'setEnabledPresetIdsForRun' | 'setExportProgress' | 'setExportStatus'
> {
  const defaults = createDefaultCompositeV2State()
  return {
    backgroundFolder: '',
    recursiveBackgrounds: false,
    backgrounds: [],
    previewHistory: [],
    previewHistoryIndex: -1,
    selectedPresetGroupId: defaults.presetGroups[0]?.id ?? '',
    selectedPreviewPresetId: defaults.presets[0]?.id ?? '',
    enabledPresetIdsForRun: defaults.presetGroups[0]?.presetIds ?? [],
    customValue: '',
    preserveSourceDir: false,
    exportStatus: 'idle',
    exportCompleted: 0,
    exportTotal: 0,
    presets: defaults.presets,
    presetGroups: defaults.presetGroups,
    outputRuleGroups: defaults.outputRuleGroups,
    globalFitMode: defaults.globalFitMode,
    historyRetention: defaults.historyRetention,
    history: defaults.history,
  }
}

export const useCompositeV2Store = create<CompositeV2StoreState>()(
  persist(
    (set) => ({
      ...createCompositeV2StoreState(),
      setBackgroundFolder: (backgroundFolder) => set({ backgroundFolder }),
      setBackgrounds: (backgrounds) => set({ backgrounds }),
      setSelectedPresetGroup: (selectedPresetGroupId) => set({ selectedPresetGroupId }),
      setEnabledPresetIdsForRun: (enabledPresetIdsForRun) => set({ enabledPresetIdsForRun }),
      setExportProgress: (exportCompleted, exportTotal) => set({ exportCompleted, exportTotal }),
      setExportStatus: (exportStatus) => set({ exportStatus }),
    }),
    {
      name: 'doupao-composite-v2-workspace-storage',
      version: 1,
      partialize: (state) => ({
        presets: state.presets,
        presetGroups: state.presetGroups,
        outputRuleGroups: state.outputRuleGroups,
        globalFitMode: state.globalFitMode,
        historyRetention: state.historyRetention,
        history: state.history,
      }),
    },
  ),
)
```

- [ ] **Step 4: Run store test**

Run:

```bash
npm test -- src/features/composite/storeV2.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/features/composite/storeV2.ts src/features/composite/storeV2.test.ts
git commit -m "feat: add composite v2 store"
```

---

### Task 10: Preset Management UI Skeleton With Floating Sidebars

**Files:**
- Create: `src/features/composite/components/PresetManagementTab.tsx`
- Create: `src/features/composite/components/PresetCanvasEditor.tsx`
- Create: `src/features/composite/components/FloatingLogoLibrary.tsx`
- Create: `src/features/composite/components/FloatingLayerToolbar.tsx`
- Modify: `src/features/composite/storeV2.ts`

- [ ] **Step 1: Add missing store actions needed by UI**

Extend `CompositeV2StoreState` with actions:

```ts
updatePreset: (presetId: string, patch: Partial<CompositeV2Preset>) => void
addImageLayerToPreset: (presetId: string, asset?: CompositeV2ImageAssetRef) => void
addTextLayerToPreset: (presetId: string) => void
```

Implement by immutably updating `presets`. Use existing defaults for layer fields:

```ts
const defaultPosition = { mode: 'free' as const, x: 100, y: 100, width: 240, height: 120 }
const defaultShadow = { enabled: false, color: '#000000', x: 0, y: 4, blur: 12, opacity: 0.25 }
```

- [ ] **Step 2: Create floating layer toolbar**

Create `src/features/composite/components/FloatingLayerToolbar.tsx`:

```tsx
type FloatingLayerToolbarProps = {
  onAddText: () => void
  onAddImage: () => void
}

export function FloatingLayerToolbar({ onAddText, onAddImage }: FloatingLayerToolbarProps) {
  return (
    <div className="absolute left-4 top-1/2 z-20 flex -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg dark:border-white/[0.08] dark:bg-gray-950">
      <button type="button" onClick={onAddText} className="h-11 w-11 border-b border-gray-100 text-lg font-semibold dark:border-white/[0.08]" title="添加文字图层">T</button>
      <button type="button" onClick={onAddImage} className="h-11 w-11 border-b border-gray-100 text-sm dark:border-white/[0.08]" title="添加图片图层">▧</button>
      <button type="button" disabled className="h-11 w-11 cursor-not-allowed text-gray-300" title="形状图层后续支持">◆</button>
      <button type="button" disabled className="h-11 w-11 cursor-not-allowed text-gray-300" title="形状图层后续支持">○</button>
    </div>
  )
}
```

- [ ] **Step 3: Create floating logo library**

Create `src/features/composite/components/FloatingLogoLibrary.tsx`:

```tsx
import type { CompositeFsImage } from '../lib/compositeTypes'

type FloatingLogoLibraryProps = {
  path: string
  assets: CompositeFsImage[]
  onSelectFolder: () => void
  onRefresh: () => void
  onPickAsset: (asset: CompositeFsImage) => void
}

export function FloatingLogoLibrary({ path, assets, onSelectFolder, onRefresh, onPickAsset }: FloatingLogoLibraryProps) {
  return (
    <aside className="absolute right-4 top-4 z-20 flex max-h-[calc(100%-2rem)] w-72 flex-col rounded-xl border border-gray-200 bg-white p-3 shadow-xl dark:border-white/[0.08] dark:bg-gray-950">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">LOGO库</h3>
        <button type="button" onClick={onSelectFolder} className="rounded-md border border-gray-200 px-3 py-1 text-xs dark:border-white/[0.08]">选择</button>
      </div>
      <div className="mb-3 flex gap-2">
        <input readOnly value={path} className="min-w-0 flex-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs dark:border-white/[0.08] dark:bg-gray-900" />
        <button type="button" onClick={onRefresh} className="rounded-md border border-gray-200 px-2 text-xs dark:border-white/[0.08]" title="刷新">↻</button>
      </div>
      <div className="grid grid-cols-3 gap-2 overflow-auto pr-1">
        {assets.map((asset) => (
          <button key={asset.path} type="button" onClick={() => onPickAsset(asset)} className="min-w-0 rounded-lg border border-gray-200 p-1 text-left dark:border-white/[0.08]">
            {asset.dataUrl ? <img src={asset.dataUrl} alt="" className="aspect-square w-full rounded-md object-contain" /> : <div className="aspect-square rounded-md bg-gray-100 dark:bg-gray-800" />}
            <div className="mt-1 truncate text-[11px] text-gray-600 dark:text-gray-300">{asset.name}</div>
          </button>
        ))}
      </div>
    </aside>
  )
}
```

- [ ] **Step 4: Create canvas editor skeleton**

Create `src/features/composite/components/PresetCanvasEditor.tsx`:

```tsx
import type { CompositeV2Preset } from '../lib/compositeV2Types'
import { FloatingLayerToolbar } from './FloatingLayerToolbar'
import { FloatingLogoLibrary } from './FloatingLogoLibrary'
import type { CompositeFsImage } from '../lib/compositeTypes'

type PresetCanvasEditorProps = {
  preset: CompositeV2Preset | null
  logoLibraryPath: string
  logoAssets: CompositeFsImage[]
  onAddText: () => void
  onAddImage: () => void
  onSelectLogoFolder: () => void
  onRefreshLogoFolder: () => void
  onPickLogo: (asset: CompositeFsImage) => void
}

export function PresetCanvasEditor(props: PresetCanvasEditorProps) {
  return (
    <div className="relative min-h-[560px] overflow-hidden rounded-lg border border-gray-200 bg-gray-100 dark:border-white/[0.08] dark:bg-gray-900">
      <FloatingLayerToolbar onAddText={props.onAddText} onAddImage={props.onAddImage} />
      <div className="flex h-full min-h-[560px] items-center justify-center p-8">
        <div className="aspect-video w-full max-w-3xl rounded-md bg-white shadow-inner dark:bg-gray-950">
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            {props.preset ? props.preset.name : '请选择预设'}
          </div>
        </div>
      </div>
      <FloatingLogoLibrary
        path={props.logoLibraryPath}
        assets={props.logoAssets}
        onSelectFolder={props.onSelectLogoFolder}
        onRefresh={props.onRefreshLogoFolder}
        onPickAsset={props.onPickLogo}
      />
    </div>
  )
}
```

- [ ] **Step 5: Create preset management tab**

Create `src/features/composite/components/PresetManagementTab.tsx`:

```tsx
import { useMemo, useState } from 'react'
import { filterPresetsForLibrary } from '../lib/compositePresetLibrary'
import { useCompositeV2Store } from '../storeV2'
import { PresetCanvasEditor } from './PresetCanvasEditor'

export function PresetManagementTab() {
  const presets = useCompositeV2Store((state) => state.presets)
  const groups = useCompositeV2Store((state) => state.presetGroups)
  const [activeGroupId, setActiveGroupId] = useState(groups[0]?.id ?? '')
  const [query, setQuery] = useState('')
  const [activePresetId, setActivePresetId] = useState(presets[0]?.id ?? '')
  const visiblePresets = useMemo(() => filterPresetsForLibrary(presets, groups, { query, groupId: activeGroupId || undefined }), [presets, groups, query, activeGroupId])
  const activePreset = presets.find((preset) => preset.id === activePresetId) ?? visiblePresets[0] ?? null

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[220px_280px_minmax(0,1fr)] gap-4">
      <section className="rounded-lg border border-gray-200 bg-white p-3 dark:border-white/[0.08] dark:bg-gray-950">
        <div className="mb-3 text-sm font-semibold">预设组</div>
        <div className="space-y-2">
          {groups.map((group) => (
            <button key={group.id} type="button" onClick={() => setActiveGroupId(group.id)} className={`w-full rounded-md px-3 py-2 text-left text-sm ${activeGroupId === group.id ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200' : 'hover:bg-gray-50 dark:hover:bg-white/[0.04]'}`}>
              {group.name}
            </button>
          ))}
        </div>
      </section>
      <section className="rounded-lg border border-gray-200 bg-white p-3 dark:border-white/[0.08] dark:bg-gray-950">
        <div className="mb-3 text-sm font-semibold">全局水印预设库</div>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索预设" className="mb-3 w-full rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-gray-900" />
        <div className="space-y-2">
          {visiblePresets.map((preset) => (
            <button key={preset.id} type="button" onClick={() => setActivePresetId(preset.id)} className={`w-full rounded-md px-3 py-2 text-left text-sm ${activePreset?.id === preset.id ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200' : 'hover:bg-gray-50 dark:hover:bg-white/[0.04]'}`}>
              {preset.name}
            </button>
          ))}
        </div>
      </section>
      <PresetCanvasEditor
        preset={activePreset}
        logoLibraryPath=""
        logoAssets={[]}
        onAddText={() => {}}
        onAddImage={() => {}}
        onSelectLogoFolder={() => {}}
        onRefreshLogoFolder={() => {}}
        onPickLogo={() => {}}
      />
    </div>
  )
}
```

- [ ] **Step 6: Build**

Run:

```bash
npm run build
```

Expected: pass.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/features/composite/storeV2.ts src/features/composite/components/PresetManagementTab.tsx src/features/composite/components/PresetCanvasEditor.tsx src/features/composite/components/FloatingLogoLibrary.tsx src/features/composite/components/FloatingLayerToolbar.tsx
git commit -m "feat: add composite preset management shell"
```

---

### Task 11: Batch Export UI Skeleton

**Files:**
- Create: `src/features/composite/components/BatchExportTab.tsx`
- Create: `src/features/composite/components/ExportResultsPanel.tsx`
- Modify: `src/features/composite/storeV2.ts`

- [ ] **Step 1: Add batch store actions**

Add actions to `storeV2.ts`:

```ts
setRecursiveBackgrounds: (recursive: boolean) => void
setCustomValue: (value: string) => void
setPreserveSourceDir: (enabled: boolean) => void
pushPreviewBackground: (path: string) => void
previousPreviewBackground: () => void
nextPreviewBackground: () => void
```

Implement each with `set`.

- [ ] **Step 2: Create results panel**

Create `src/features/composite/components/ExportResultsPanel.tsx`:

```tsx
import type { CompositeV2ExportStatus, CompositeV2HistoryRecord } from '../lib/compositeV2Types'

type ExportResultsPanelProps = {
  status: CompositeV2ExportStatus
  completed: number
  total: number
  history: CompositeV2HistoryRecord[]
}

export function ExportResultsPanel({ status, completed, total, history }: ExportResultsPanelProps) {
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-white/[0.08] dark:bg-gray-950">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">导出结果</h3>
        <span className="text-xs text-gray-500">{status}</span>
      </div>
      <div className="mb-3 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
        <div className="h-full bg-blue-500" style={{ width: `${progress}%` }} />
      </div>
      <div className="text-sm text-gray-600 dark:text-gray-300">{completed} / {total}</div>
      <div className="mt-4 text-xs text-gray-500">历史记录 {history.length} 条</div>
    </section>
  )
}
```

- [ ] **Step 3: Create batch export tab**

Create `src/features/composite/components/BatchExportTab.tsx`:

```tsx
import { useMemo } from 'react'
import { useCompositeV2Store } from '../storeV2'
import { ExportResultsPanel } from './ExportResultsPanel'

export function BatchExportTab() {
  const backgroundFolder = useCompositeV2Store((state) => state.backgroundFolder)
  const recursive = useCompositeV2Store((state) => state.recursiveBackgrounds)
  const backgrounds = useCompositeV2Store((state) => state.backgrounds)
  const groups = useCompositeV2Store((state) => state.presetGroups)
  const selectedGroupId = useCompositeV2Store((state) => state.selectedPresetGroupId)
  const enabledPresetIds = useCompositeV2Store((state) => state.enabledPresetIdsForRun)
  const customValue = useCompositeV2Store((state) => state.customValue)
  const status = useCompositeV2Store((state) => state.exportStatus)
  const completed = useCompositeV2Store((state) => state.exportCompleted)
  const total = useCompositeV2Store((state) => state.exportTotal)
  const history = useCompositeV2Store((state) => state.history)
  const setCustomValue = useCompositeV2Store((state) => state.setCustomValue)
  const selectedGroup = useMemo(() => groups.find((group) => group.id === selectedGroupId) ?? groups[0] ?? null, [groups, selectedGroupId])

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)_300px] grid-rows-[minmax(0,1fr)_auto] gap-4">
      <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-white/[0.08] dark:bg-gray-950">
        <h3 className="mb-3 text-sm font-semibold">背景文件夹</h3>
        <button type="button" className="mb-3 w-full rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-white/[0.08]">选择文件夹</button>
        <div className="truncate text-xs text-gray-500">{backgroundFolder || '未选择'}</div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={recursive} readOnly />
          递归子文件夹
        </label>
        <div className="mt-3 text-xs text-gray-500">已加载 {backgrounds.length} 张</div>
      </section>
      <section className="rounded-lg border border-gray-200 bg-gray-100 p-4 dark:border-white/[0.08] dark:bg-gray-900">
        <div className="flex h-full items-center justify-center rounded-md bg-white text-sm text-gray-400 dark:bg-gray-950">
          随机背景预览
        </div>
      </section>
      <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-white/[0.08] dark:bg-gray-950">
        <h3 className="mb-3 text-sm font-semibold">本次导出</h3>
        <div className="mb-3 text-sm">{selectedGroup?.name ?? '未选择预设组'}</div>
        <input value={customValue} onChange={(event) => setCustomValue(event.target.value)} placeholder="custom 参数" className="mb-3 w-full rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-gray-900" />
        <div className="text-xs text-gray-500">已勾选 {enabledPresetIds.length} 个预设</div>
        <button type="button" className="mt-4 w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white">开始导出</button>
      </section>
      <div className="col-span-3">
        <ExportResultsPanel status={status} completed={completed} total={total} history={history} />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Build**

Run:

```bash
npm run build
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/features/composite/storeV2.ts src/features/composite/components/BatchExportTab.tsx src/features/composite/components/ExportResultsPanel.tsx
git commit -m "feat: add composite batch export shell"
```

---

### Task 12: Wire The V2 Workspace Tabs

**Files:**
- Modify: `src/features/composite/CompositeWorkspace.tsx`

- [ ] **Step 1: Replace the current workspace render with V2 tabs**

Keep the file export name `CompositeWorkspace`. Replace the body with a small tab shell:

```tsx
import { useState } from 'react'
import { BatchExportTab } from './components/BatchExportTab'
import { PresetManagementTab } from './components/PresetManagementTab'

type CompositeTab = 'batch' | 'presets'

export default function CompositeWorkspace() {
  const [tab, setTab] = useState<CompositeTab>('batch')

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-50 p-4 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <div className="mb-4 flex items-center gap-2">
        <button type="button" onClick={() => setTab('batch')} className={`rounded-md px-4 py-2 text-sm font-medium ${tab === 'batch' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 dark:bg-gray-900 dark:text-gray-200'}`}>批量导出</button>
        <button type="button" onClick={() => setTab('presets')} className={`rounded-md px-4 py-2 text-sm font-medium ${tab === 'presets' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 dark:bg-gray-900 dark:text-gray-200'}`}>预设管理</button>
      </div>
      {tab === 'batch' ? <BatchExportTab /> : <PresetManagementTab />}
    </div>
  )
}
```

If the existing file contains useful helper code that will be reused, move it into focused files before replacing the component. Do not keep unused imports.

- [ ] **Step 2: Build**

Run:

```bash
npm run build
```

Expected: pass.

- [ ] **Step 3: Manual smoke in dev server**

Run:

```bash
npm run dev
```

Open the app, switch to postprocess, verify:

- Two tabs appear.
- Batch export tab renders without overlap at desktop width.
- Preset management tab renders with the floating logo library and layer toolbar.

- [ ] **Step 4: Commit**

Run:

```bash
git add src/features/composite/CompositeWorkspace.tsx
git commit -m "feat: switch composite workspace to v2 tabs"
```

---

### Task 13: Implement Folder Loading And Preview Selection

**Files:**
- Modify: `src/features/composite/components/BatchExportTab.tsx`
- Modify: `src/features/composite/storeV2.ts`

- [ ] **Step 1: Wire folder selection**

In `BatchExportTab.tsx`, add a handler:

```tsx
async function selectBackgroundFolder() {
  const api = window.electronAPI
  const dirPath = await api?.selectDirectory?.()
  if (!dirPath) return
  setBackgroundFolder(dirPath)
  const files = await api?.listCompositeBackgroundFiles?.(dirPath, recursive)
  setBackgrounds(naturalSortBackgrounds(files ?? []))
}
```

Import `naturalSortBackgrounds`. Add store selectors for `setBackgroundFolder` and `setBackgrounds`.

- [ ] **Step 2: Wire recursive toggle reload**

When recursive changes and `backgroundFolder` is set, reload files using `listCompositeBackgroundFiles(backgroundFolder, nextRecursive)`.

- [ ] **Step 3: Wire preview history buttons**

Add buttons:

- `上一张`
- `换一张`
- `下一张`

For `换一张`, pick a random item from `backgrounds` and call `pushPreviewBackground(path)`.

- [ ] **Step 4: Build**

Run:

```bash
npm run build
```

Expected: pass.

- [ ] **Step 5: Manual smoke**

Run:

```bash
npm run dev
```

Verify:

- Selecting a folder loads count.
- Recursive toggle reloads.
- Preview path changes when clicking random next.
- Previous and next stay within viewed history.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/features/composite/components/BatchExportTab.tsx src/features/composite/storeV2.ts
git commit -m "feat: wire composite background loading"
```

---

### Task 14: Implement Canvas Rendering For Preview And Export Data URLs

**Files:**
- Create: `src/features/composite/lib/compositeRendererV2.ts`
- Test: focus on pure render plan tests already covered; use manual visual verification for Canvas.
- Modify: `src/features/composite/components/PresetCanvasEditor.tsx`
- Modify: `src/features/composite/components/BatchExportTab.tsx`

- [ ] **Step 1: Create renderer entry points**

Create `src/features/composite/lib/compositeRendererV2.ts`:

```ts
import { chooseRenderBranch, mapLayerPositionToCanvas, planBackgroundFit } from './compositeRenderPlan'
import type { CompositeV2BackgroundImage, CompositeV2FitMode, CompositeV2Preset } from './compositeV2Types'

export type CompositeV2RenderInput = {
  backgroundDataUrl: string
  backgroundSize: { width: number; height: number }
  preset: CompositeV2Preset
  targetSize: { width: number; height: number }
  fitMode: CompositeV2FitMode
  quality?: number
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片加载失败'))
    image.src = src
  })
}

export async function renderCompositeV2ToCanvas(input: CompositeV2RenderInput, canvas: HTMLCanvasElement) {
  canvas.width = input.targetSize.width
  canvas.height = input.targetSize.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前环境不支持 Canvas')
  const background = await loadImage(input.backgroundDataUrl)
  const branch = chooseRenderBranch(input.backgroundSize, input.targetSize)
  if (branch === 'source-first') {
    ctx.drawImage(background, 0, 0, input.targetSize.width, input.targetSize.height)
  } else if (input.fitMode === 'contain-blur') {
    ctx.filter = 'blur(24px)'
    ctx.drawImage(background, 0, 0, input.targetSize.width, input.targetSize.height)
    ctx.filter = 'none'
    const rect = planBackgroundFit(input.fitMode, input.backgroundSize, input.targetSize)
    ctx.drawImage(background, rect.sx, rect.sy, rect.sw, rect.sh, rect.dx, rect.dy, rect.dw, rect.dh)
  } else {
    const rect = planBackgroundFit(input.fitMode, input.backgroundSize, input.targetSize)
    ctx.drawImage(background, rect.sx, rect.sy, rect.sw, rect.sh, rect.dx, rect.dy, rect.dw, rect.dh)
  }

  for (const layer of [...input.preset.layers].reverse()) {
    if (!layer.visible) continue
    const rect = mapLayerPositionToCanvas(layer.position, input.preset.baseCanvas, input.targetSize)
    ctx.save()
    ctx.globalAlpha = layer.opacity
    ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2)
    ctx.rotate((layer.rotation * Math.PI) / 180)
    if (layer.type === 'text') {
      ctx.font = `${layer.fontWeight} ${layer.fontSize}px ${layer.fontFamily}`
      ctx.fillStyle = layer.color
      ctx.textAlign = layer.align
      ctx.textBaseline = 'middle'
      for (const [lineIndex, line] of layer.text.split('\n').entries()) {
        const y = (lineIndex - (layer.text.split('\n').length - 1) / 2) * layer.fontSize * layer.lineHeight
        if (layer.stroke.enabled) {
          ctx.strokeStyle = layer.stroke.color
          ctx.lineWidth = layer.stroke.width
          ctx.strokeText(line, 0, y, rect.width)
        }
        ctx.fillText(line, 0, y, rect.width)
      }
    }
    ctx.restore()
  }
}

export async function renderCompositeV2ToJpegDataUrl(input: CompositeV2RenderInput) {
  const canvas = document.createElement('canvas')
  await renderCompositeV2ToCanvas(input, canvas)
  return canvas.toDataURL('image/jpeg', input.quality ?? 0.9)
}
```

This initial renderer draws text layers. Add image layer drawing in the same file before marking this task complete, using `layer.asset.path` or loaded data URL from Electron. Keep shape layers out.

- [ ] **Step 2: Wire preview canvases**

In `PresetCanvasEditor.tsx` and `BatchExportTab.tsx`, render a `<canvas>` and call the renderer when selected background or preset changes.

- [ ] **Step 3: Build**

Run:

```bash
npm run build
```

Expected: pass.

- [ ] **Step 4: Manual visual verification**

Run:

```bash
npm run dev
```

Verify:

- Text layer appears on the editor canvas.
- Image layer appears after selecting a logo asset.
- Batch preview renders current background and selected preset.
- Floating panels do not cover required controls at desktop width.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/features/composite/lib/compositeRendererV2.ts src/features/composite/components/PresetCanvasEditor.tsx src/features/composite/components/BatchExportTab.tsx
git commit -m "feat: render composite v2 previews"
```

---

### Task 15: Implement Export Runtime With Pause Resume Cancel

**Files:**
- Create: `src/features/composite/lib/compositeExportRuntime.ts`
- Modify: `src/features/composite/components/BatchExportTab.tsx`
- Modify: `src/features/composite/components/ExportResultsPanel.tsx`
- Modify: `src/features/composite/storeV2.ts`

- [ ] **Step 1: Create runtime controller**

Create `src/features/composite/lib/compositeExportRuntime.ts`:

```ts
import { buildCompositeOutputPathParts } from './compositePathTemplates'
import { expandCompositeExportItems, type CompositeV2ExportSnapshot } from './compositeExportPlan'
import { renderCompositeV2ToJpegDataUrl } from './compositeRendererV2'
import type { CompositeV2FailureItem, CompositeV2SuccessItem } from './compositeV2Types'

export type CompositeV2ExportRuntimeCallbacks = {
  onProgress: (completed: number, total: number) => void
  onSuccess: (item: CompositeV2SuccessItem) => void
  onFailure: (item: CompositeV2FailureItem) => void
  shouldPause: () => boolean
  shouldCancel: () => boolean
}

export async function runCompositeV2Export(snapshot: CompositeV2ExportSnapshot, callbacks: CompositeV2ExportRuntimeCallbacks) {
  const items = expandCompositeExportItems(snapshot)
  callbacks.onProgress(0, items.length)
  let completed = 0
  for (const item of items) {
    while (callbacks.shouldPause() && !callbacks.shouldCancel()) {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    if (callbacks.shouldCancel()) break
    try {
      const backgroundPayload = await window.electronAPI?.readImageFile?.(item.background.path)
      if (!backgroundPayload?.dataUrl) throw new Error('背景图读取失败')
      const dataUrl = await renderCompositeV2ToJpegDataUrl({
        backgroundDataUrl: backgroundPayload.dataUrl,
        backgroundSize: { width: backgroundPayload.width ?? item.outputRule.width, height: backgroundPayload.height ?? item.outputRule.height },
        preset: item.preset,
        targetSize: { width: item.outputRule.width, height: item.outputRule.height },
        fitMode: snapshot.fitMode,
        quality: 0.9,
      })
      const pathParts = buildCompositeOutputPathParts({
        date: item.date,
        channel: item.outputRule.channelName,
        size: item.outputRule.name,
        preset: item.preset.name,
        index: item.index,
        source: item.background.name.replace(/\.[^.]+$/, ''),
        sourceDir: item.background.relativeDir,
        custom: item.custom,
        subfolderTemplate: item.outputRule.subfolderTemplate,
        filenameTemplate: item.outputRule.filenameTemplate,
        preserveSourceDir: snapshot.preserveSourceDir,
      })
      const outputPath = await window.electronAPI?.pathJoin?.(item.preset.outputRootPath, pathParts.dateFolder, ...pathParts.subfolders, pathParts.filename)
      if (!outputPath) throw new Error('输出路径生成失败')
      const saved = await window.electronAPI?.saveCompositeImage?.(outputPath, dataUrl)
      if (!saved) throw new Error('图片写入失败')
      callbacks.onSuccess({ path: outputPath, presetId: item.preset.id, presetName: item.preset.name, channel: item.outputRule.channelName, size: item.outputRule.name, index: item.index })
    } catch (error) {
      callbacks.onFailure({
        backgroundPath: item.background.path,
        presetId: item.preset.id,
        presetName: item.preset.name,
        channel: item.outputRule.channelName,
        size: item.outputRule.name,
        reason: error instanceof Error ? error.message : '未知错误',
      })
    }
    completed += 1
    callbacks.onProgress(completed, items.length)
  }
}
```

Use the existing preload names already present in the project: `readImageFile`, `pathJoin`, and `saveCompositeImage`. Use the new Task 8 preload names only for `listCompositeBackgroundFiles` and `deleteCompositeFiles`.

- [ ] **Step 2: Add runtime state and controls**

In `storeV2.ts`, add:

```ts
requestPauseExport: () => void
resumeExport: () => void
requestCancelExport: () => void
```

Use `exportStatus` values `running`, `paused`, and `canceling`.

- [ ] **Step 3: Wire start export**

In `BatchExportTab.tsx`, build a snapshot with `createCompositeExportSnapshot` and pass it to `runCompositeV2Export`.

- [ ] **Step 4: Wire controls**

Add buttons:

- Pause when status is `running`.
- Resume when status is `paused`.
- Cancel when status is `running` or `paused`.

On cancel, show a `ConfirmDialog` or existing modal pattern asking whether to keep or delete already written files.

- [ ] **Step 5: Build**

Run:

```bash
npm run build
```

Expected: pass.

- [ ] **Step 6: Manual export smoke**

Run:

```bash
npm run dev
```

Verify with a small folder:

- Export starts.
- Progress increments.
- Pause stops progress.
- Resume continues without repeating completed items.
- Cancel stops remaining items.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/features/composite/lib/compositeExportRuntime.ts src/features/composite/components/BatchExportTab.tsx src/features/composite/components/ExportResultsPanel.tsx src/features/composite/storeV2.ts
git commit -m "feat: add composite v2 export runtime"
```

---

### Task 16: Add JPG Max-KB Compression To Runtime

**Files:**
- Modify: `src/features/composite/lib/compositeExportRuntime.ts`
- Modify: `src/features/composite/lib/compositeRendererV2.ts`
- Modify: `src/features/composite/components/ExportResultsPanel.tsx`

- [ ] **Step 1: Add byte-size helper**

In `compositeExportRuntime.ts`, add:

```ts
function dataUrlSizeKb(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1] ?? ''
  return Math.ceil((base64.length * 3 / 4) / 1024)
}
```

- [ ] **Step 2: Use binary quality search**

Use `chooseJpegQuality` with an async render loop. Because `chooseJpegQuality` currently accepts a sync estimator, add an async helper in runtime:

```ts
async function renderWithMaxKb(input: Omit<Parameters<typeof renderCompositeV2ToJpegDataUrl>[0], 'quality'>, maxSizeKb: number) {
  let low = 0.5
  let high = 0.9
  let bestDataUrl = await renderCompositeV2ToJpegDataUrl({ ...input, quality: low })
  if (dataUrlSizeKb(bestDataUrl) > maxSizeKb) {
    return { dataUrl: bestDataUrl, warning: `最低质量 0.5 仍超过 ${maxSizeKb}KB` }
  }
  for (let i = 0; i < 8; i += 1) {
    const quality = (low + high) / 2
    const dataUrl = await renderCompositeV2ToJpegDataUrl({ ...input, quality })
    if (dataUrlSizeKb(dataUrl) <= maxSizeKb) {
      bestDataUrl = dataUrl
      low = quality
    } else {
      high = quality
    }
  }
  return { dataUrl: bestDataUrl }
}
```

- [ ] **Step 3: Mark success warnings**

When `renderWithMaxKb` returns a warning, include it in `CompositeV2SuccessItem.warning`.

- [ ] **Step 4: Show warning badges**

In `ExportResultsPanel.tsx`, render warning markers in successful item details.

- [ ] **Step 5: Build and manual compression smoke**

Run:

```bash
npm run build
npm run dev
```

Verify:

- A small `maxSizeKb` produces a saved file.
- If it cannot fit, the item is success with a warning.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/features/composite/lib/compositeExportRuntime.ts src/features/composite/lib/compositeRendererV2.ts src/features/composite/components/ExportResultsPanel.tsx
git commit -m "feat: apply composite jpg max kb compression"
```

---

### Task 17: Finish Preset Editing Interactions

**Files:**
- Modify: `src/features/composite/components/PresetCanvasEditor.tsx`
- Modify: `src/features/composite/components/PresetManagementTab.tsx`
- Modify: `src/features/composite/storeV2.ts`

- [ ] **Step 1: Add selected layer state**

In `PresetCanvasEditor.tsx`, maintain selected layer ID and expose clicks on layer handles.

- [ ] **Step 2: Implement drag and resize**

Use pointer events on the canvas wrapper:

```tsx
function onPointerDown(event: React.PointerEvent, layerId: string) {
  event.currentTarget.setPointerCapture(event.pointerId)
  setDragState({ layerId, startX: event.clientX, startY: event.clientY })
}
```

Update current positioning mode only. For free mode, update `x` and `y`. For anchor mode, update `offsetX` and `offsetY`.

- [ ] **Step 3: Add property panel**

In `PresetManagementTab.tsx`, add a right-side property section for selected layer:

- Name.
- Visibility.
- Lock.
- Position mode.
- x, y, width, height for free mode.
- Anchor, margins, offsets for anchor mode.
- Image opacity, rotation, radius, shadow.
- Text font, size, color, weight, stroke, shadow, align, line height, letter spacing.

- [ ] **Step 4: Wire logo clicks**

When logo asset is clicked:

- If selected layer is an image layer, replace its asset.
- Otherwise add a new image layer with that asset.

- [ ] **Step 5: Build and manual editor smoke**

Run:

```bash
npm run build
npm run dev
```

Verify:

- Add text layer.
- Add image layer from toolbar.
- Add image layer from logo library.
- Drag layer.
- Resize layer.
- Edit fields and see canvas update.
- Layer list order top-to-bottom matches render order.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/features/composite/components/PresetCanvasEditor.tsx src/features/composite/components/PresetManagementTab.tsx src/features/composite/storeV2.ts
git commit -m "feat: complete composite preset layer editing"
```

---

### Task 18: Finish Results Details And Persistent History

**Files:**
- Modify: `src/features/composite/components/ExportResultsPanel.tsx`
- Modify: `src/features/composite/storeV2.ts`
- Modify: `src/features/composite/lib/compositeExportRuntime.ts`

- [ ] **Step 1: Persist history after export**

When runtime finishes, build a `CompositeV2HistoryRecord` with:

- status
- start and end times
- counts
- successes
- failures
- cleanup result

Use `addCompositeHistoryRecord`.

- [ ] **Step 2: Add result details UI**

In `ExportResultsPanel.tsx`, add sections:

- Success count and failure count.
- Summary by preset.
- Summary by channel and size.
- Successful output path list.
- Warning badges inside success list.
- Failure list with reasons.
- History list.

- [ ] **Step 3: Add history retention setting**

Expose a numeric input in a compact settings area, defaulting to 10. Clamp to at least 1.

- [ ] **Step 4: Build and manual history smoke**

Run:

```bash
npm run build
npm run dev
```

Verify:

- A completed export creates a history record.
- Reloading the app keeps history.
- Retention limit removes older entries.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/features/composite/components/ExportResultsPanel.tsx src/features/composite/storeV2.ts src/features/composite/lib/compositeExportRuntime.ts
git commit -m "feat: persist composite export history"
```

---

### Task 19: Full Verification And Cleanup

**Files:**
- Modify only files needed to fix verification failures.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- src/features/composite/lib/compositeV2Types.test.ts src/features/composite/lib/compositeBackgrounds.test.ts src/features/composite/lib/compositeOutputRulesV2.test.ts src/features/composite/lib/compositePathTemplates.test.ts src/features/composite/lib/compositePresetLibrary.test.ts src/features/composite/lib/compositeExportPlan.test.ts src/features/composite/lib/compositeRenderPlan.test.ts src/features/composite/lib/compositeJpeg.test.ts src/features/composite/lib/compositeExportHistoryV2.test.ts src/features/composite/storeV2.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run existing composite tests**

Run:

```bash
npm test -- src/features/composite/lib
```

Expected: all composite lib tests pass. If old tests no longer match intentionally replaced behavior, update or remove only the tests tied to removed old behavior and mention that in the commit.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: TypeScript and Vite build pass.

- [ ] **Step 5: Manual acceptance pass**

Run:

```bash
npm run dev
```

Verify:

- Postprocess opens the V2 workspace.
- Background folder load works with and without recursion.
- Random preview, previous, and next work.
- Preset management creates and edits presets and groups.
- Floating logo library and layer toolbar remain present.
- A small export produces expected JPG files.
- Output path includes root, date folder, template folders, optional source subfolder, and filename.
- Pause, resume, and cancel work.
- Cancel asks keep/delete.
- History persists after reload.

- [ ] **Step 6: Check diff for unrelated edits**

Run:

```bash
git status --short
git diff --stat
```

Expected: only files required by this implementation are changed.

- [ ] **Step 7: Commit final cleanup**

Run:

```bash
git add src/features/composite electron src/vite-env.d.ts
git commit -m "chore: verify composite postprocess v2"
```

Only make this commit if Step 6 has real cleanup or verification fixes. If no files changed, skip this commit.
