import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, extname, sep } from 'node:path'

const PATTERNS = {
  gray: /\b(?:bg-white|bg-gray-\d+|text-gray-\d+|border-gray-\d+|bg-slate-\d+|text-slate-\d+|border-slate-\d+|bg-zinc-\d+|text-zinc-\d+|border-zinc-\d+|bg-neutral-\d+|text-neutral-\d+|border-neutral-\d+)\b/g,
  brandBlue: /\b(?:bg-blue-\d+|text-blue-\d+|border-blue-\d+|ring-blue-\d+)\b/g,
  semantic: /\b(?:bg-emerald-\d+|text-emerald-\d+|bg-amber-\d+|text-amber-\d+|bg-red-\d+|text-red-\d+|bg-rose-\d+|text-rose-\d+)\b/g,
  rounded: /\brounded-(?:xl|2xl|3xl)\b/g,
  hex: /#[0-9a-fA-F]{3,8}\b/g,
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'design-system') continue
      walk(p, out)
    } else if (extname(p) === '.ts' || extname(p) === '.tsx') {
      if (!/\.test\.(ts|tsx)$/.test(e.name)) out.push(p)
    }
  }
  return out
}

const cur = {}
for (const f of walk('src')) {
  const src = readFileSync(f, 'utf8')
  const key = f.split(sep).join('/').replace(/^src\//, '')
  for (const [name, re] of Object.entries(PATTERNS)) {
    re.lastIndex = 0
    const n = (src.match(re) || []).length
    if (n > 0) cur[`${key}|${name}`] = n
  }
}

let out = ''
for (const [k, v] of Object.entries(cur).sort()) out += `  '${k}': ${v},\n`
writeFileSync('legacy-snapshot-new.txt', out)
console.log('entries:', Object.keys(cur).length)
const byType = {}
for (const [k, v] of Object.entries(cur)) {
  const t = k.split('|')[1]
  byType[t] = (byType[t] || 0) + v
}
console.log('按类型:', JSON.stringify(byType))
