/**
 * 控件/内容高度全面迁移脚本（无豁免，全仓统一）。
 *
 * 把裸高度类迁移到 ds-* 语义类：
 *  控件尺度（h-7~h-11）→ h-ds-control-{sm,md,lg}（统一到三档，28/44px 归一）
 *  内容尺度（h-12/14/16、h-[52px]）→ h-ds-{12,14,16,52}（像素值不变，仅统一命名）
 *  正方形成对处理（h-N w-N / w-N h-N）→ 同步迁移宽度，保证不变形
 *
 * 安全边界：高度类必须是独立 Tailwind token——
 *  - 前/后不能是 [\w-]（排除 max-h-*、min-w-*、SVG path 命令 h7、h-7z 等误伤）
 *
 * 用法：
 *   node scripts/migrate-control-heights.mjs --dry-run   # 只打印将改动的行
 *   node scripts/migrate-control-heights.mjs             # 写入文件
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, extname, sep } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

// 高度档映射：裸高度 → ({ h, minH, w })
const TIER = {
  7: { h: 'h-ds-control-sm', minH: 'min-h-ds-control-sm', w: 'w-ds-control-sm' },
  8: { h: 'h-ds-control-sm', minH: 'min-h-ds-control-sm', w: 'w-ds-control-sm' },
  9: { h: 'h-ds-control-md', minH: 'min-h-ds-control-md', w: 'w-ds-control-md' },
  10: { h: 'h-ds-control-lg', minH: 'min-h-ds-control-lg', w: 'w-ds-control-lg' },
  11: { h: 'h-ds-control-lg', minH: 'min-h-ds-control-lg', w: 'w-ds-control-lg' },
  12: { h: 'h-ds-12', minH: 'min-h-ds-12', w: 'w-ds-12' },
  14: { h: 'h-ds-14', minH: 'min-h-ds-14', w: 'w-ds-14' },
  16: { h: 'h-ds-16', minH: 'min-h-ds-16', w: 'w-ds-16' },
  52: { h: 'h-ds-52', minH: 'min-h-ds-52', w: 'w-ds-52' },
}

// 全仓 src 下所有 .tsx/.ts（跳过 design-system 自身、测试、构建产物）
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

const DRY = process.argv.includes('--dry-run')
const files = walk(join(ROOT, 'src'))
let totalChanges = 0

for (const file of files) {
  const rel = file.replace(ROOT + sep, '').replaceAll('\\', '/')
  const lines = readFileSync(file, 'utf8').split('\n')
  const changed = []

  lines.forEach((line, idx) => {
    const original = line

    // 独立 token 边界：前/后都不能是 [\w-]（排除 max-h-*、min-w-*、h-7z、SVG path h7 等）
    const B = (cls) => `(?<![\\w-])${cls}(?![\\w-])`

    // 1) h-[52px] / w-[52px] / min-h-[52px] 任意值
    line = line.replace(new RegExp(B('h-\\[52px\\]'), 'g'), 'h-ds-52')
    line = line.replace(new RegExp(B('w-\\[52px\\]'), 'g'), 'w-ds-52')
    line = line.replace(new RegExp(B('min-h-\\[52px\\]'), 'g'), 'min-h-ds-52')

    // 2) 成对正方形（h-N w-N 或 w-N h-N）→ 语义正方形
    for (const [n, tier] of Object.entries(TIER)) {
      line = line.replace(new RegExp(B(`h-${n} w-${n}`), 'g'), `${tier.h} ${tier.w}`)
      line = line.replace(new RegExp(B(`w-${n} h-${n}`), 'g'), `${tier.w} ${tier.h}`)
    }

    // 3) 剩余单边 h-N / min-h-N
    for (const [n, tier] of Object.entries(TIER)) {
      line = line.replace(new RegExp(B(`h-${n}`), 'g'), tier.h)
      line = line.replace(new RegExp(B(`min-h-${n}`), 'g'), tier.minH)
    }

    if (line !== original) {
      changed.push({ line: idx + 1, before: original.trim().slice(0, 140), after: line.trim().slice(0, 140) })
      lines[idx] = line
    }
  })

  if (changed.length > 0) {
    totalChanges += changed.length
    console.log(`\n===== ${rel} (${changed.length} 处) =====`)
    if (DRY) {
      for (const c of changed.slice(0, 8)) {
        console.log(`  L${c.line}:\n    - ${c.before}\n    + ${c.after}`)
      }
      if (changed.length > 8) console.log(`  ... 还有 ${changed.length - 8} 处`)
    } else {
      writeFileSync(file, lines.join('\n'))
    }
  }
}

console.log(`\n合计改动: ${totalChanges} 处 ${DRY ? '(dry-run)' : '(已写入)'}`)