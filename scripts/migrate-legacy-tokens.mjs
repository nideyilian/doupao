/**
 * 旧 Tailwind 工具类 → ds.* 语义 Token 迁移脚本（一次性，可重复执行验证）。
 *
 * 规则来源：
 * - 中性色（gray/slate/zinc/neutral/white）映射对齐 src/theme/styles/skins.css 的桥接语义
 *   （50/100→surface，200/300→surface-subtle，900/950→scrim 等），并在默认皮肤下保持层级；
 * - 品牌色（blue/violet/purple）→ primary 语义（修复「双蓝」）；
 * - 语义色（emerald/green/amber/yellow/red/rose）→ success/warning/danger；
 * - 写死的 text-[hsl(var(--ds-color-*))] 任意值 → 同名 ds.* 命名空间类（零视觉变化）；
 * - 实心品牌底色 + text-white 的按钮组合按行配对迁移为 primary/danger + text-inverse；
 * - 图片角标类（带透明度实心色、bg-black/*、text-white 独立出现）保持不动。
 *
 * 用法：node scripts/migrate-legacy-tokens.mjs
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname, sep } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'design-system' || entry.name === 'dist') continue
      walk(p, out)
    } else if (extname(p) === '.tsx' || extname(p) === '.ts') {
      if (/\.test\.(ts|tsx)$/.test(entry.name)) continue
      out.push(p)
    }
  }
  return out
}

/* ---------- 精确替换：任意值 hsl / shadcn 旧类 / 任意字号 ---------- */
const EXACT = [
  // 任意值 hsl(var(--ds-color-*)) → 命名空间类（tailwind.config 已补全）
  [/text-\[hsl\(var\(--ds-color-text-subtle\)\)\]/g, 'text-ds-text-subtle'],
  [/text-\[hsl\(var\(--ds-color-text-muted\)\)\]/g, 'text-ds-muted'],
  [/text-\[hsl\(var\(--ds-color-text\)\)\]/g, 'text-ds-text'],
  [/text-\[hsl\(var\(--ds-color-text-inverse\)\)\]/g, 'text-ds-text-inverse'],
  [/text-\[hsl\(var\(--ds-color-primary\)\)\]/g, 'text-ds-primary'],
  [/text-\[hsl\(var\(--ds-color-danger\)\)\]/g, 'text-ds-danger'],
  [/text-\[hsl\(var\(--ds-color-success\)\)\]/g, 'text-ds-success'],
  [/text-\[hsl\(var\(--ds-color-warning\)\)\]/g, 'text-ds-warning'],
  [/text-\[hsl\(var\(--ds-color-selection-text\)\)\]/g, 'text-ds-selection-text'],
  [/bg-\[hsl\(var\(--ds-color-surface-subtle\)\)\]/g, 'bg-ds-subtle'],
  [/bg-\[hsl\(var\(--ds-color-surface\)\)\]/g, 'bg-ds-surface'],
  [/bg-\[hsl\(var\(--ds-color-surface-raised\)\)\]/g, 'bg-ds-raised'],
  [/bg-\[hsl\(var\(--ds-color-primary\)\)\]/g, 'bg-ds-primary'],
  [/bg-\[hsl\(var\(--ds-color-primary-hover\)\)\]/g, 'bg-ds-primary-hover'],
  [/bg-\[hsl\(var\(--ds-color-primary-subtle\)\)\]/g, 'bg-ds-primary-subtle'],
  [/bg-\[hsl\(var\(--ds-color-danger\)\)\]/g, 'bg-ds-danger'],
  [/bg-\[hsl\(var\(--ds-color-danger-subtle\)\)\]/g, 'bg-ds-danger-subtle'],
  [/bg-\[hsl\(var\(--ds-color-success-subtle\)\)\]/g, 'bg-ds-success-subtle'],
  [/bg-\[hsl\(var\(--ds-color-warning-subtle\)\)\]/g, 'bg-ds-warning-subtle'],
  [/bg-\[hsl\(var\(--ds-color-scrim\)\/(\d+(?:\.\d+)?)\)\]/g, 'bg-ds-scrim/$1'],
  [/border-\[hsl\(var\(--ds-color-border\)\)\]/g, 'border-ds-border'],
  [/border-\[hsl\(var\(--ds-color-border-strong\)\)\]/g, 'border-ds-border-strong'],
  [/border-\[hsl\(var\(--ds-color-primary\)\/(\d+(?:\.\d+)?)\)\]/g, 'border-ds-primary/$1'],
  [/border-\[hsl\(var\(--ds-color-danger\)\/(\d+(?:\.\d+)?)\)\]/g, 'border-ds-danger/$1'],
  [/ring-\[hsl\(var\(--ds-color-focus\)\)\]/g, 'ring-ds-focus'],
  [/shadow-\[var\(--ds-shadow-lg\)\]/g, 'shadow-ds-lg'],
  // shadcn 旧变量类（与 index.css 的 .doupao-side-panel 桥接同义，收敛到 ds.*）
  [/bg-background(\/\d+(?:\.\d+)?|\[[^\]]+\])?/g, 'bg-ds-canvas$1'],
  [/text-foreground/g, 'text-ds-text'],
  [/text-muted-foreground/g, 'text-ds-muted'],
  [/bg-muted(\/\d+(?:\.\d+)?)?/g, 'bg-ds-subtle$1'],
  [/border-border/g, 'border-ds-border'],
  [/bg-primary/g, 'bg-ds-primary'],
  [/text-primary-foreground/g, 'text-ds-text-inverse'],
  [/text-primary(?!-foreground)/g, 'text-ds-primary'],
  [/dark:hover:bg-blue-400/g, 'dark:hover:bg-ds-primary-hover'],
  [/dark:bg-blue-400/g, 'dark:bg-ds-primary-hover'],
  [/dark:bg-blue-950/g, 'dark:bg-ds-primary-subtle'],
  [/bg-sidebar/g, 'bg-ds-subtle'],
  [/text-sidebar-foreground/g, 'text-ds-text'],
  // 任意字号（仅补在 DS 字号体系内的）
  [/text-\[13px\]/g, 'text-ds-sm'],
  [/text-\[14px\]/g, 'text-ds-md'],
  // 圆角：值级等价映射（默认皮肤 12/16/24px 不变，皮肤可接管圆角）
  [/\brounded-3xl\b/g, 'rounded-ds-2xl'],
  [/\brounded-2xl\b/g, 'rounded-ds-xl'],
  [/\brounded-xl\b/g, 'rounded-ds-lg'],
]

/* ---------- Token 映射 ---------- */
const NEUTRAL = ['gray', 'slate', 'zinc', 'neutral']
const BRAND = ['blue', 'violet', 'purple']

const SEMANTIC_MAP = {
  emerald: 'success', green: 'success',
  amber: 'warning', yellow: 'warning',
  red: 'danger', rose: 'danger',
}

// text: 中性灰阶 → 语义文字层级
// 注意：文字层级 token 是 --ds-color-text-subtle（类名 text-ds-text-subtle），
// 不是 surface-subtle（类名 text-ds-subtle 是表面色，用作文字会暗底暗字）。
function mapTextShade(shade, dark, hover) {
  const s = shade ?? 700
  if (dark) {
    if (hover) return s >= 400 && s <= 600 ? 'muted' : 'text'
    return s >= 700 ? 'text' : s >= 300 ? 'muted' : 'text-subtle'
  }
  if (hover) return s >= 400 && s <= 600 ? 'muted' : 'text'
  return s >= 700 ? 'text' : s >= 400 ? 'muted' : 'text-subtle'
}

// bg: 中性灰阶 → 表面层级
function mapBgShade(shade, dark, hover) {
  const s = shade ?? 100
  if (dark) {
    if (hover) return s >= 200 && s <= 900 ? 'subtle' : 'surface'
    return s >= 900 ? 'scrim' : s >= 600 ? 'subtle' : 'surface'
  }
  if (hover) return s <= 400 ? 'subtle' : 'scrim'
  return s >= 700 ? 'scrim' : s >= 400 ? 'muted' : s >= 200 ? 'subtle' : 'surface'
}

// border: 中性灰阶 → 边框层级
function mapBorderShade(shade) {
  const s = shade ?? 200
  return s >= 400 ? 'border-strong' : 'border'
}

const TOKEN_RE =
  /((?:[\w-]+:)*)(bg|text|border|ring)-(white|gray|slate|zinc|neutral|blue|violet|purple|emerald|green|amber|yellow|red|rose)(?:-(\d+))?((?:\/\d+(?:\.\d+)?)|(?:\/\[[^\]]+\]))?/g

function mapToken(match, prefix, type, color, shadeRaw, alpha) {
  const shade = shadeRaw ? Number(shadeRaw) : null
  const dark = prefix.includes('dark:')
  const hover = prefix.includes('hover:')
  const sem = SEMANTIC_MAP[color]
  const a = alpha ?? ''

  if (type === 'text') {
    if (color === 'white' || color === 'black') return null // 保持不动（反色文字/覆盖层）
    if (NEUTRAL.includes(color)) {
      const t = mapTextShade(shade, dark, hover)
      return `${prefix}text-ds-${t}`
    }
    if (BRAND.includes(color)) return `${prefix}text-ds-primary`
    if (sem) return `${prefix}text-ds-${sem}`
  }

  if (type === 'bg') {
    if (color === 'white') {
      // 深色下极低透明度（≤10%）的面板浮起 → 实心 surface，避免透明深色不可见
      if (dark && alpha && parseAlpha(alpha) <= 10) return `${prefix}bg-ds-surface`
      return `${prefix}bg-ds-surface${a}`
    }
    if (NEUTRAL.includes(color)) {
      const t = mapBgShade(shade, dark, hover)
      return `${prefix}bg-ds-${t}${a}`
    }
    if (BRAND.includes(color)) {
      if (shade !== null && shade <= 200) return `${prefix}bg-ds-primary-subtle${a}`
      if (alpha) return `${prefix}bg-ds-primary${a}` // 带透明度的芯片
      return null // 实心品牌底色：交给配对迁移（按钮）或保持（角标）
    }
    if (sem) {
      if (shade !== null && shade <= 100) return `${prefix}bg-ds-${sem}-subtle${a}`
      if (alpha) return `${prefix}bg-ds-${sem}${a}`
      return null
    }
  }

  if (type === 'border') {
    if (color === 'white') {
      if (dark) return `${prefix}border-ds-border` // 深色下的白色描边 → 主题边框
      return null
    }
    if (NEUTRAL.includes(color)) {
      const t = mapBorderShade(shade)
      return `${prefix}border-ds-${t}${a}`
    }
    if (BRAND.includes(color)) {
      const s = shade ?? 500
      const b = s <= 300 ? 'border-ds-primary/35' : 'border-ds-primary'
      return `${prefix}${b}${s > 300 && alpha ? a : ''}`
    }
    if (sem) {
      const s = shade ?? 500
      const b = s <= 300 ? `border-ds-${sem}/35` : `border-ds-${sem}`
      return `${prefix}${b}${s > 300 && alpha ? a : ''}`
    }
  }

  if (type === 'ring') {
    if (BRAND.includes(color)) return `${prefix}ring-ds-focus${a}`
    return null
  }
  return null
}

function parseAlpha(alpha) {
  const m = alpha.match(/(\d+(?:\.\d+)?)/)
  return m ? Number(m[1]) : 100
}

/* ---------- 配对迁移：实心品牌底色 + text-white 的按钮 ---------- */
// hover: 前缀 → 语义 hover token（hover:bg-blue-600 → hover:bg-ds-primary-hover）
const SOLID_BG_RE =
  /(\b(?:[\w-]+:)*)(bg-(?:blue|violet|purple|red|rose|emerald|green|amber|yellow)-(?:400|500|600|700|800))(?![/\d])/g
const SEM_BY_COLOR = {
  blue: 'primary', violet: 'primary', purple: 'primary',
  red: 'danger', rose: 'danger', emerald: 'success', green: 'success',
  amber: 'warning', yellow: 'warning',
}

function migratePairButtons(src) {
  // 逐行处理：同一行内出现「实心品牌底 + text-white」才整体转语义按钮
  return src
    .split('\n')
    .map((line) => {
      const solidBgs = [...line.matchAll(SOLID_BG_RE)]
      if (solidBgs.length === 0) return line
      let out = line.replace(SOLID_BG_RE, (full, prefix, bgPart) => {
        const color = bgPart.match(/bg-(blue|violet|purple|red|rose|emerald|green|amber|yellow)/)[1]
        const sem = SEM_BY_COLOR[color]
        const hover = prefix.includes('hover:')
        return `${prefix}bg-ds-${sem}${hover ? '-hover' : ''}`
      })
      // 仅当该行确有实心品牌底时，把同行的 text-white 转 text-inverse
      if (/bg-ds-(primary|danger|success|warning)(?!-)/.test(out)) {
        out = out.replace(/\btext-white\b/g, 'text-ds-text-inverse')
      }
      return out
    })
    .join('\n')
}

/* ---------- 主流程 ---------- */
const DRY = process.argv.includes('--dry-run')
const files = walk(join(ROOT, 'src'))
let totalChanged = 0
const perFile = []

for (const file of files) {
  let src = readFileSync(file, 'utf8')
  const before = src

  for (const [re, rep] of EXACT) src = src.replace(re, rep)
  src = src.replace(TOKEN_RE, (m, p, t, c, s, a) => mapToken(m, p, t, c, s, a) ?? m)
  src = migratePairButtons(src)

  if (src !== before) {
    if (!DRY) writeFileSync(file, src)
    totalChanged++
    perFile.push([file.replace(ROOT + sep, ''), before.length - src.length])
  }
}

console.log(`${DRY ? '[DRY-RUN] ' : ''}迁移文件数: ${totalChanged}`)
for (const [f, d] of perFile.sort((a, b) => b[1] - a[1])) console.log(`  ${f}  (变化 ${Math.abs(d)} 字符)`)
