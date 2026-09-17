/**
 * 文件名净化的公共内核。
 *
 * 仓库里曾有 6 份各自实现的「文件名 / 路径净化」，**它们语义并不相同**（替换符 `-` vs `_`、
 * 截断长度 100 / 220 / 无、尾部处理、兜底值各异），所以这里不合并成一个函数 ——
 * 只抽出真正一致的部分：非法字符集 + 空白压缩。
 * 截断、trim 时机、兜底值仍由各调用点按自己的语义决定。
 *
 * 未纳入本内核的三处（**刻意保留独立实现，不要强行合并**）：
 * - `compositePathTemplates.sanitizePathSegment`：用非 `+` 的正则（连续非法字符产出多个 `_`），
 *   且另有 Windows 保留名（con/prn/aux…）处理，语义确实不同。
 * - `requirementPrototype/manifests.ts`：XML / xlsx 场景，字符集不同。
 * - `generatedImageFilename.sanitizeGeneratedImageFilenamePart`：压缩空白与剥非法字符的**顺序相反**
 *   （控制字符类含 `\n` / `\t`，先替换会把 prompt 换行变成 `-`）。它共享 `INVALID_FILE_NAME_CHARS`
 *   常量，但不走本函数。
 */

/** Windows 非法文件名字符（含控制字符）。与各调用点原来的 `[<>:"/\\|?*\x00-\x1f]+` 完全一致。 */
// eslint-disable-next-line no-control-regex -- 文件名控制字符剥离是刻意行为
export const INVALID_FILE_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001F]+/g

/**
 * 剥掉非法字符并压缩连续空白。
 * 不 trim、不截断、不兜底 —— 这些由调用点自己决定（它们本来就各不相同）。
 */
export function sanitizeFileNameCore(value: string, replacement = '-'): string {
  // `String.prototype.replace` 对带 g 的正则会把 lastIndex 归零，共享这个正则对象是安全的
  return value.replace(INVALID_FILE_NAME_CHARS, replacement).replace(/\s+/g, ' ')
}
