/**
 * 全仓设计一致性审计脚本（只读，不修改任何文件）。
 *
 * 统计四个维度的"杂度"并输出 JSON 报告，供人工提炼成审计报告：
 *  A. 新旧风格：裸 Tailwind 旧类（可被 migrate-legacy-tokens.mjs 迁移的）vs 已用的 ds-* 语义 Token
 *  B. 控件高度：裸 h-N / min-h-N 高度类 vs --ds-control-* 尺度 Token
 *  C. 图标系统：手写内联 <svg> vs lucide-react vs 其他图标库
 *  D. 配色：写死 hex / text-white / text-black / 裸品牌与语义色
 *
 * 用法：node scripts/audit-design-consistency.mjs [--json tasks/design-audit.json]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, extname, sep } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'design-system', '.git'].includes(entry.name)) continue
      walk(p, out)
    } else if (extname(p) === '.tsx' || extname(p) === '.ts') {
      if (/\.test\.(ts|tsx)$/.test(entry.name)) continue
      out.push(p)
    }
  }
  return out
}

/* ============ A. 旧类 → Token 可迁移计数（复用 migrate-legacy-tokens 的规则） ============ */

const EXACT = [
  /\btext-\[hsl\(var\(--ds-color-text-subtle\)\)\]\b/g,
  /\btext-\[hsl\(var\(--ds-color-text-muted\)\)\]\b/g,
  /\btext-\[hsl\(var\(--ds-color-text\)\)\]\b/g,
  /\btext-\[hsl\(var\(--ds-color-text-inverse\)\)\]\b/g,
  /\btext-\[hsl\(var\(--ds-color-primary\)\)\]\b/g,
  /\btext-\[hsl\(var\(--ds-color-danger\)\)\]\b/g,
  /\btext-\[hsl\(var\(--ds-color-success\)\)\]\b/g,
  /\btext-\[hsl\(var\(--ds-color-warning\)\)\]\b/g,
  /\btext-\[hsl\(var\(--ds-color-selection-text\)\)\]\b/g,
  /\bbg-\[hsl\(var\(--ds-color-surface-subtle\)\)\]\b/g,
  /\bbg-\[hsl\(var\(--ds-color-surface\)\)\]\b/g,
  /\bbg-\[hsl\(var\(--ds-color-surface-raised\)\)\]\b/g,
  /\bbg-\[hsl\(var\(--ds-color-primary\)\)\]\b/g,
  /\bbg-\[hsl\(var\(--ds-color-primary-hover\)\)\]\b/g,
  /\bbg-\[hsl\(var\(--ds-color-primary-subtle\)\)\]\b/g,
  /\bbg-\[hsl\(var\(--ds-color-danger\)\)\]\b/g,
  /\bbg-\[hsl\(var\(--ds-color-danger-subtle\)\)\]\b/g,
  /\bbg-\[hsl\(var\(--ds-color-success-subtle\)\)\]\b/g,
  /\bbg-\[hsl\(var\(--ds-color-warning-subtle\)\)\]\b/g,
  /\bbg-\[hsl\(var\(--ds-color-scrim\)\/(\d+(?:\.\d+)?)\)\]\b/g,
  /\bborder-\[hsl\(var\(--ds-color-border\)\)\]\b/g,
  /\bborder-\[hsl\(var\(--ds-color-border-strong\)\)\]\b/g,
  /\bborder-\[hsl\(var\(--ds-color-primary\)\/(\d+(?:\.\d+)?)\)\]\b/g,
  /\bborder-\[hsl\(var\(--ds-color-danger\)\/(\d+(?:\.\d+)?)\)\]\b/g,
  /\bring-\[hsl\(var\(--ds-color-focus\)\)\]\b/g,
  /\bshadow-\[var\(--ds-shadow-lg\)\]\b/g,
  /\bbg-background(\/\d+(?:\.\d+)?|\[[^\]]+\])?\b/g,
  /\btext-foreground\b/g,
  /\btext-muted-foreground\b/g,
  /\bbg-muted(\/\d+(?:\.\d+)?)?\b/g,
  /\bborder-border\b/g,
  /\bbg-primary\b/g,
  /\btext-primary-foreground\b/g,
  /\btext-primary(?!-foreground)\b/g,
  /\bdark:hover:bg-blue-400\b/g,
  /\bdark:bg-blue-400\b/g,
  /\bdark:bg-blue-950\b/g,
  /\bbg-sidebar\b/g,
  /\btext-sidebar-foreground\b/g,
  /\btext-\[13px\]\b/g,
  /\btext-\[14px\]\b/g,
  /\brounded-3xl\b/g,
  /\brounded-2xl\b/g,
  /\brounded-xl\b/g,
]

const NEUTRAL = ['gray', 'slate', 'zinc', 'neutral']
const BRAND = ['blue', 'violet', 'purple']
const SEMANTIC_MAP = { emerald: 'success', green: 'success', amber: 'warning', yellow: 'warning', red: 'danger', rose: 'danger' }

// 统计"可迁移旧类"：命中 TOKEN_RE 且映射函数返回非 null 的才算可迁移
const TOKEN_RE =
  /((?:[\w-]+:)*)(bg|text|border|ring)-(white|gray|slate|zinc|neutral|blue|violet|purple|emerald|green|amber|yellow|red|rose)(?:-(\d+))?((?:\/\d+(?:\.\d+)?)|(?:\/\[[^\]]+\]))?/g

function mapTokenNullable(match, prefix, type, color, shadeRaw, alpha) {
  const shade = shadeRaw ? Number(shadeRaw) : null
  const dark = prefix.includes('dark:')
  const sem = SEMANTIC_MAP[color]
  if (type === 'text') {
    if (color === 'white' || color === 'black') return null
    return true
  }
  if (type === 'bg') {
    if (color === 'white') return true
    if (NEUTRAL.includes(color)) return true
    if (BRAND.includes(color)) {
      if (shade !== null && shade <= 200) return true
      if (alpha) return true
      return null // 实心品牌底色（按钮/角标）不自动迁移
    }
    if (sem) {
      if (shade !== null && shade <= 100) return true
      if (alpha) return true
      return null
    }
  }
  if (type === 'border') {
    if (color === 'white') return dark ? true : null
    if (NEUTRAL.includes(color)) return true
    if (BRAND.includes(color)) return true
    if (sem) return true
  }
  if (type === 'ring') {
    if (BRAND.includes(color)) return true
    return null
  }
  return null
}

function countMigratable(src) {
  let exact = 0
  for (const re of EXACT) {
    exact += (src.match(re) ?? []).length
  }
  let token = 0
  TOKEN_RE.lastIndex = 0
  for (const m of src.matchAll(TOKEN_RE)) {
    if (mapTokenNullable(...m)) token++
  }
  return { exact, token, total: exact + token }
}

/* ============ B. 控件高度 ============ */
const HEIGHT_RE =
  /(?<![\w-])(?:min-)?h-(?:7|8|9|10|11|12|14|16)(?![\w-])/g
const HEIGHT_PX_RE = /(?<![\w-])(?:min-)?h-\[(?:40|42|44|48|50|52|56|60|64)px\](?![\w-])/g
const CONTROL_TOKEN_RE = /--ds-control-|\bds-control\b/g

/* ============ C. 图标 ============ */
const LUCIDE_IMPORT_RE = /from\s+['"]lucide-react['"]/g
const SVG_TAG_RE = /<svg\b/g
const LOBE_ICONS_RE = /@lobehub\/icons|react-icons|heroicons|@heroicons/g

/* ============ D. 配色 ============ */
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g
const TEXT_WHITE_RE = /\btext-white\b/g
const TEXT_BLACK_RE = /\btext-black\b/g

/* ds-* 语义 Token 使用 */
const DS_USAGE_RE = /(?:bg|text|border|ring|rounded|shadow)-ds-|--ds-color-|--ds-space-|--ds-radius-|--ds-font-/g

const files = walk(join(ROOT, 'src'))
const rows = []

for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const rel = file.replace(ROOT + sep, '').replaceAll('\\', '/')
  const lines = src.split('\n').length

  const mig = countMigratable(src)

  const heights = new Set()
  for (const m of src.matchAll(HEIGHT_RE)) heights.add(m[0])
  for (const m of src.matchAll(HEIGHT_PX_RE)) heights.add(m[0])

  const lucideImportCount = (src.match(LUCIDE_IMPORT_RE) ?? []).length
  const svgCount = (src.match(SVG_TAG_RE) ?? []).length
  const lobeCount = (src.match(LOBE_ICONS_RE) ?? []).length

  const dsUsage = (src.match(DS_USAGE_RE) ?? []).length
  const hexCount = (src.match(HEX_RE) ?? []).length

  rows.push({
    file: rel,
    lines,
    legacyTotal: mig.total,
    legacyExact: mig.exact,
    legacyTokenClass: mig.token,
    heightCount: heights.size,
    heightClasses: [...heights].sort(),
    dsUsage,
    svgCount,
    lucideImportCount,
    lobeCount,
    textWhite: (src.match(TEXT_WHITE_RE) ?? []).length,
    textBlack: (src.match(TEXT_BLACK_RE) ?? []).length,
    hexCount,
  })
}

/* ============ 汇总 ============ */
const totals = rows.reduce(
  (acc, r) => {
    acc.files++
    acc.lines += r.lines
    acc.legacyTotal += r.legacyTotal
    acc.legacyExact += r.legacyExact
    acc.legacyTokenClass += r.legacyTokenClass
    acc.heightFiles += r.heightCount > 0 ? 1 : 0
    acc.heightClasses += r.heightCount
    acc.dsUsage += r.dsUsage
    acc.svgFiles += r.svgCount > 0 ? 1 : 0
    acc.svgCount += r.svgCount
    acc.lucideFiles += r.lucideImportCount > 0 ? 1 : 0
    acc.lucideCount += r.lucideImportCount
    acc.lobeFiles += r.lobeCount > 0 ? 1 : 0
    acc.textWhite += r.textWhite
    acc.textBlack += r.textBlack
    acc.hexCount += r.hexCount
    return acc
  },
  { files: 0, lines: 0, legacyTotal: 0, legacyExact: 0, legacyTokenClass: 0, heightFiles: 0, heightClasses: 0, dsUsage: 0, svgFiles: 0, svgCount: 0, lucideFiles: 0, lucideCount: 0, lobeFiles: 0, textWhite: 0, textBlack: 0, hexCount: 0 },
)

const topLegacy = [...rows].sort((a, b) => b.legacyTotal - a.legacyTotal).slice(0, 15).map((r) => ({ file: r.file, legacyTotal: r.legacyTotal, dsUsage: r.dsUsage }))
const topHeight = [...rows].filter((r) => r.heightCount > 0).sort((a, b) => b.heightCount - a.heightCount).slice(0, 15).map((r) => ({ file: r.file, heightCount: r.heightCount, heights: r.heightClasses.slice(0, 8) }))
const topSvg = [...rows].filter((r) => r.svgCount > 0).sort((a, b) => b.svgCount - a.svgCount).slice(0, 15).map((r) => ({ file: r.file, svgCount: r.svgCount, lucideImportCount: r.lucideImportCount }))
const topHex = [...rows].filter((r) => r.hexCount > 0).sort((a, b) => b.hexCount - a.hexCount).slice(0, 15).map((r) => ({ file: r.file, hexCount: r.hexCount }))

const report = { totals, topLegacy, topHeight, topSvg, topHex, rows }

const jsonFlag = process.argv.indexOf('--json')
if (jsonFlag >= 0 && process.argv[jsonFlag + 1]) {
  const outPath = join(ROOT, process.argv[jsonFlag + 1])
  writeFileSync(outPath, JSON.stringify(report, null, 2))
  console.log(`JSON 报告已写入: ${outPath}`)
}

/* ============ 控制台汇总 ============ */
console.log('===== 全仓设计一致性审计（src 业务代码） =====')
console.log(`文件数: ${totals.files}  总行数: ${totals.lines}`)
console.log('')
console.log('--- A. 新旧风格（可迁移旧类 vs ds-* Token） ---')
console.log(`  可迁移旧类总数: ${totals.legacyTotal}（EXACT ${totals.legacyExact} + TOKEN ${totals.legacyTokenClass}）`)
console.log(`  ds-* 语义 Token 使用: ${totals.dsUsage}`)
console.log('  旧类最多的文件 Top 10:')
for (const r of topLegacy.slice(0, 10)) console.log(`    ${r.file}: 旧类 ${r.legacyTotal}  ds* ${r.dsUsage}`)
console.log('')
console.log('--- B. 控件高度 ---')
console.log(`  出现裸高度类的文件: ${totals.heightFiles}，去重高度类组合数: ${totals.heightClasses}`)
console.log('  高度变体最多的文件 Top 10:')
for (const r of topHeight.slice(0, 10)) console.log(`    ${r.file}: ${r.heightCount} 种  (${r.heights.join(', ')})`)
console.log('')
console.log('--- C. 图标系统 ---')
console.log(`  手写内联 <svg> 文件: ${totals.svgFiles}，<svg> 总数: ${totals.svgCount}`)
console.log(`  lucide-react 导入文件: ${totals.lucideFiles}，import 语句数: ${totals.lucideCount}`)
console.log(`  其他图标库文件: ${totals.lobeFiles}`)
console.log('  <svg> 最多文件 Top 10:')
for (const r of topSvg.slice(0, 10)) console.log(`    ${r.file}: <svg> ${r.svgCount}  lucide导入 ${r.lucideImportCount}`)
console.log('')
console.log('--- D. 配色 ---')
console.log(`  写死 hex: ${totals.hexCount}  text-white: ${totals.textWhite}  text-black: ${totals.textBlack}`)
console.log('  hex 最多文件 Top 10:')
for (const r of topHex.slice(0, 10)) console.log(`    ${r.file}: hex ${r.hexCount}`)
