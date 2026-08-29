import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, extname, sep } from 'node:path'

// 修复语义错位的 Tailwind 类：
// 1) text-ds-subtle → text-ds-text-subtle
//    ds.subtle = --ds-color-surface-subtle（表面色）；文字层级应为 --ds-color-text-subtle。
//    暗色下 text-ds-subtle 解析为 surface-subtle（#282A2E ≈ 背景色）→ 文字看不见。
// 2) bg-ds-muted（纯色，无透明度）→ bg-ds-subtle
//    ds.muted = --ds-color-text-muted（文字色）；作为纯色背景应使用表面色 subtle。

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'design-system') continue
      walk(p, out)
    } else if (extname(p) === '.tsx' || extname(p) === '.ts') {
      if (!/\.test\.(ts|tsx)$/.test(e.name)) out.push(p)
    }
  }
  return out
}

let fix1 = 0
let fix2 = 0
const files = walk('src')
for (const f of files) {
  const before = readFileSync(f, 'utf8')
  let src = before
  const n1 = (src.match(/\btext-ds-subtle\b/g) || []).length
  if (n1 > 0) {
    src = src.replace(/\btext-ds-subtle\b/g, 'text-ds-text-subtle')
    fix1 += n1
  }
  // 纯色 bg-ds-muted（后面不是 /透明度）
  const n2 = (src.match(/\bbg-ds-muted(?![/\w-])/g) || []).length
  if (n2 > 0) {
    src = src.replace(/\bbg-ds-muted(?![/\w-])/g, 'bg-ds-subtle')
    fix2 += n2
  }
  if (src !== before) writeFileSync(f, src)
}
console.log(`text-ds-subtle → text-ds-text-subtle: ${fix1} 处`)
console.log(`bg-ds-muted(纯色) → bg-ds-subtle: ${fix2} 处`)
