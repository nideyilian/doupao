import { describe, expect, it } from 'vitest'
import { sanitizeGeneratedImageFilenamePart } from './generatedImageFilename'
import { sanitizeFolderName } from './localSave'
import { sanitizeFileNameCore } from './sanitizeFileName'

/**
 * O-8：仓库里曾有 6 份各自实现的「文件名净化」。收敛只发生在**语义确实一致**的部分，
 * 这些用例锁定「收敛前后同一输入产出同一结果」，同时也把各处**有意保留的差异**钉住 ——
 * 防止后来者"顺手统一"而悄悄改变文件名。
 *
 * 样本覆盖：Windows 保留字符、路径分隔符、控制字符、中文、emoji、首尾空白、超长输入。
 */
describe('文件名净化收敛后的等价性', () => {
  it('sanitizeFileNameCore 只做「剥非法字符 + 压缩空白」，不 trim、不截断、不兜底', () => {
    expect(sanitizeFileNameCore('  a\n\tb:c  ')).toBe(' a-b-c ')
    expect(sanitizeFileNameCore('a<b>c:d"e/f\\g|h?i*j')).toBe('a-b-c-d-e-f-g-h-i-j')
    expect(sanitizeFileNameCore('红色 海报')).toBe('红色 海报')
    expect(sanitizeFileNameCore('emoji🎨名称')).toBe('emoji🎨名称')
  })

  it('sanitizeFolderName 保留原语义：trim → 剥字符 → 截断 100 → 空则「未命名」', () => {
    expect(sanitizeFolderName('   ')).toBe('未命名')
    expect(sanitizeFolderName('')).toBe('未命名')
    expect(sanitizeFolderName('  a<b>c  ')).toBe('a-b-c')
    expect(sanitizeFolderName('a'.repeat(300))).toHaveLength(100)
  })

  it('sanitizeGeneratedImageFilenamePart 保持「先压缩空白再剥非法字符」的顺序（与内核相反）', () => {
    // 换行/制表应归成空格，而不是被控制字符类替换成 `-`
    expect(sanitizeGeneratedImageFilenamePart('  a\n\tb:c  ')).toBe('a b-c')
    expect(sanitizeGeneratedImageFilenamePart('红色\n海报')).toBe('红色 海报')
    expect(sanitizeGeneratedImageFilenamePart('x'.repeat(101), 100)).toHaveLength(100)
    // 不传 maxLength 时不截断
    expect(sanitizeGeneratedImageFilenamePart('x'.repeat(300))).toHaveLength(300)
  })

  it('路径分隔符一律被剥离（不会把文件名拼成子目录）', () => {
    expect(sanitizeFileNameCore('../../etc/passwd')).toBe('..-..-etc-passwd')
    expect(sanitizeFolderName('..\\..\\windows')).toBe('..-..-windows')
  })
})
