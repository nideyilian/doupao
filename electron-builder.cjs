/**
 * electron-builder 配置（JS 形式，支持按环境变量条件签名）。
 *
 * 签名说明（无证书时保持现状，有证书时自动启用）：
 * - Windows：设置环境变量 CSC_LINK（证书文件路径/URL）与 CSC_KEY_PASSWORD（私钥密码）后构建即自动签名；
 *   再设置 CSC_PUBLISHER_NAME 以写入 publisherName（electron-updater 在 Windows 上会校验发布者）。
 * - macOS：设置 APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID 后自动公证（notarize）。
 * 风险提示：未签名构建的 Windows 安装包会被 SmartScreen 拦截，且 updater 只能做 sha512 完整性校验、
 *   无法验证发布者身份——正式分发前请配置代码签名证书。
 */
const https = require('https')

const PUBLISH_OWNER = 'nideyilian'
const PUBLISH_REPO = 'doupao'

/**
 * 发布前预建 GitHub release，消除 electron-builder 的发布竞态。
 *
 * 背景：PublishManager 的 nameToPublisher 缓存没有 in-flight 去重，nsis 目标会几乎同时
 * 抛出 Setup exe 与 blockmap 两个 artifact 事件，两次都查不到缓存 → 建出两个 publisher，
 * 各自独立调用 getOrCreateRelease，同时判定「release 不存在」→ 竞态创建出两条同 tag 的
 * release，附件被劈成两半（一条只有 blockmap，另一条有 exe 与 latest.yml）。而 GitHub 的
 * releases/download/<tag>/<file> 只解析到其中一条，于是 latest.yml 与安装包全部 404——
 * v0.8.15 就是这么坏的：自动更新与下载同时失效，但构建本身仍然显示 success。
 *
 * 修复：在打包完成、目标产物（进而发布）开始之前先把 release 建好，两个 publisher 都会
 * 复用它。放在这里而不是 workflow 里，是因为本地 `npm run release` 走的是同一条竞态路径。
 */
function githubApiRequest(method, apiPath, token, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body)
    const request = https.request(
      {
        hostname: 'api.github.com',
        path: apiPath,
        method,
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'doupao-release-hook',
          authorization: `Bearer ${token}`,
          ...(payload
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
            : {}),
        },
      },
      (response) => {
        let raw = ''
        response.on('data', (chunk) => {
          raw += chunk
        })
        response.on('end', () => {
          let data = null
          try {
            data = raw ? JSON.parse(raw) : null
          } catch {
            data = raw
          }
          resolve({ status: response.statusCode, data })
        })
      },
    )
    request.on('error', reject)
    if (payload) request.write(payload)
    request.end()
  })
}

/** 只在确实要发布时才碰远端：本地 dry 构建（--publish never）绝不能创建 release。 */
function shouldEnsureGithubRelease() {
  const argv = process.argv.slice(2)
  const index = argv.findIndex((arg) => arg === '--publish' || arg === '-p')
  if (index >= 0) return argv[index + 1] === 'always'
  // 未显式指定 --publish 时，CI 的 tag 构建仍会按 onTagOrDraft 发布
  return process.env.GITHUB_REF_TYPE === 'tag'
}

async function ensureGithubRelease(tag, token) {
  const basePath = `/repos/${PUBLISH_OWNER}/${PUBLISH_REPO}`
  const list = await githubApiRequest('GET', `${basePath}/releases?per_page=100`, token)
  if (list.status !== 200) {
    throw new Error(`查询 release 列表失败（HTTP ${list.status}）：${JSON.stringify(list.data)}`)
  }
  const existing = Array.isArray(list.data) ? list.data.find((item) => item.tag_name === tag) : null
  if (existing) return existing.id
  const created = await githubApiRequest('POST', `${basePath}/releases`, token, {
    tag_name: tag,
    name: tag,
    draft: false,
    prerelease: false,
  })
  if (created.status !== 201) {
    throw new Error(`创建 release ${tag} 失败（HTTP ${created.status}）：${JSON.stringify(created.data)}`)
  }
  return created.data.id
}

module.exports = {
  appId: 'com.cooksleep.doupao-v2',
  productName: 'DOUPAO V2',
  directories: {
    // 默认输出到 release/；可通过 DOUPAO_EB_OUTPUT 覆盖（受限环境下工作区内重命名被拦截时，
    // 把产物输出到工作区外可绕过）。
    output: process.env.DOUPAO_EB_OUTPUT || 'release',
  },
  icon: 'public/icon.ico',
  files: ['dist/**/*', 'dist-electron/**/*'],
  // 在 afterPack 阶段由 electron-builder 翻转 fuses，确保发生在签名和制作安装包之前。
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
  },
  publish: {
    provider: 'github',
    owner: PUBLISH_OWNER,
    repo: PUBLISH_REPO,
    releaseType: 'release',
  },
  // 在打包完成后、目标产物（进而发布）开始前预建 release，让所有 publisher 复用它。
  // 失败时直接让构建失败：静默退回竞态发布正是产生坏 release 的原因。
  async afterPack(context) {
    if (!shouldEnsureGithubRelease()) return
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
    if (!token) {
      console.warn('[release-hook] 未提供 GH_TOKEN / GITHUB_TOKEN，跳过预建 release')
      return
    }
    // 与 GitHubPublisher 的 tag 推导保持一致：githubTagPrefix 默认加 'v'
    const tag = `v${context.packager.appInfo.version}`
    const maxAttempts = 3
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const releaseId = await ensureGithubRelease(tag, token)
        console.log(`[release-hook] release ${tag} 已就绪（id=${releaseId}），后续 publisher 将复用它`)
        return
      } catch (error) {
        if (attempt === maxAttempts) {
          throw new Error(`[release-hook] 预建 release ${tag} 失败：${error.message}`)
        }
        console.warn(`[release-hook] 第 ${attempt} 次预建 release 失败，稍后重试：${error.message}`)
        await new Promise((resolve) => setTimeout(resolve, attempt * 2000))
      }
    }
  },
  win: {
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'portable', arch: ['x64'] },
    ],
    // 无证书时跳过签名，但仍编辑 EXE 资源（图标、版本信息等）。
    signExecutable: Boolean(process.env.CSC_LINK),
  },
  ...(process.env.CSC_LINK && process.env.CSC_PUBLISHER_NAME
    ? { publisherName: [process.env.CSC_PUBLISHER_NAME] }
    : {}),
  mac: {
    target: ['dmg'],
    hardenedRuntime: true,
    gatekeeperAssess: false,
    ...(process.env.APPLE_ID ? { notarize: { teamId: process.env.APPLE_TEAM_ID ?? true } } : {}),
  },
  linux: {
    target: ['AppImage'],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
}
