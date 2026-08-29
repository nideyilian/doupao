/**
 * 对打包产物启用 Electron fuses 加固：
 * - 禁用 RunAsNode（防止以 ELECTRON_RUN_AS_NODE 方式执行任意代码）
 * - 启用 Cookie 加密
 * - 禁用 Node 选项环境变量 / CLI inspect 参数注入
 * - 启用 asar 完整性校验 + 仅从 asar 加载（防篡改）
 *
 * 用法：electron-builder 打包完成后执行（win-unpacked / mac / linux 产物自动探测）。
 */
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses'
import { existsSync, readdirSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const releaseRoot = path.join(__dirname, '..', 'release')

function findPackagedBinary() {
  const candidates = []
  const winUnpacked = path.join(releaseRoot, 'win-unpacked')
  if (existsSync(winUnpacked)) {
    candidates.push(
      ...readdirSync(winUnpacked)
        .filter((name) => name.endsWith('.exe'))
        .map((name) => path.join(winUnpacked, name)),
    )
  }
  const macDir = path.join(releaseRoot, 'mac', 'DOUPAO V2.app', 'Contents', 'MacOS')
  if (existsSync(macDir)) {
    candidates.push(
      ...readdirSync(macDir)
        .filter((name) => !name.endsWith('.dylib'))
        .map((name) => path.join(macDir, name)),
    )
  }
  const linuxDir = path.join(releaseRoot, 'linux-unpacked')
  if (existsSync(linuxDir)) {
    candidates.push(
      ...readdirSync(linuxDir)
        .filter((name) => !name.endsWith('.so'))
        .map((name) => path.join(linuxDir, name)),
    )
  }
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

const binary = findPackagedBinary()
if (!binary) {
  console.warn('[apply-fuses] 未找到打包产物，跳过 fuses 加固（本机未执行 electron-builder）')
  process.exit(0)
}

await flipFuses(binary, {
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
})

console.log(`[apply-fuses] fuses 加固完成: ${binary}`)
