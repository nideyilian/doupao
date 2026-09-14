/**
 * 发布健康检查：确认某个版本在 GitHub Releases 上的产物完整可用。
 *
 * 背景：v0.8.15 曾出现「构建 success、release 也存在，但安装包与 latest.yml 全部 404」
 * 的坏发布——electron-builder 并发发布竞态会创建出多条同 tag 的 release，附件被劈成两半，
 * 而 GitHub 的 releases/download/<tag>/<file> 只解析到其中一条。electron-updater 读的
 * 正是 latest.yml，缺了它所有存量用户都收不到更新，但流水线本身不会报错。
 *
 * 用法：
 *   npm run release:check              # 检查 package.json 里的当前版本
 *   npm run release:check -- v0.8.15   # 检查指定 tag
 *
 * 检查项：
 *   1. latest.yml 可下载，且其中的 version 与 tag 对应
 *   2. latest.yml 列出的每个产物可下载，且大小与记录一致
 *   3. 安装包的 .blockmap 是否存在（缺失只影响增量更新，记为警告）
 *   4. 同一个 tag 是否对应多条 release（需要 GH_TOKEN，>1 即竞态复发的信号）
 */
import { readFileSync } from 'fs'
import https from 'https'
import path from 'path'
import { fileURLToPath } from 'url'

const OWNER = 'nideyilian'
const REPO = 'doupao'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageJson = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'))
const tag = process.argv[2] || `v${packageJson.version}`
const expectedVersion = tag.replace(/^v/, '')
const downloadBase = `https://github.com/${OWNER}/${REPO}/releases/download/${tag}`

const passed = []
const warnings = []
const problems = []

function request(url, method = 'GET', headers = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const req = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        path: target.pathname + target.search,
        method,
        headers: { 'user-agent': 'doupao-release-check', ...headers },
      },
      (res) => {
        const location = res.headers.location
        if (res.statusCode >= 300 && res.statusCode < 400 && location) {
          res.resume()
          resolve(request(new URL(location, url).toString(), method, headers))
          return
        }
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }),
        )
      },
    )
    req.on('error', reject)
    req.end()
  })
}

/** 用 Range 请求只取 1 字节来问总大小，服务端不支持时退回 content-length。 */
async function probeFile(name) {
  const url = `${downloadBase}/${name}`
  const res = await request(url, 'GET', { range: 'bytes=0-0' })
  const range = res.headers['content-range']
  const total = range ? Number(range.split('/')[1]) : Number(res.headers['content-length'])
  return { name, status: res.status, size: Number.isFinite(total) ? total : null }
}

async function checkDuplicateReleases() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  if (!token) {
    warnings.push('未提供 GH_TOKEN / GITHUB_TOKEN，跳过「同 tag 多条 release」检查')
    return
  }
  const api = await request(`https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=100`, 'GET', {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
  })
  if (api.status !== 200) {
    warnings.push(`查询 release 列表失败（HTTP ${api.status}）`)
    return
  }
  const releases = JSON.parse(api.body.toString('utf-8')).filter((item) => item.tag_name === tag)
  if (releases.length === 0) {
    problems.push(`找不到 tag=${tag} 的 release`)
    return
  }
  if (releases.length > 1) {
    problems.push(
      `发现 ${releases.length} 条同 tag 的 release（id=${releases.map((r) => r.id).join(', ')}）` +
        `：electron-builder 发布竞态复发，附件可能被劈开`,
    )
    return
  }
  passed.push(`release 唯一（id=${releases[0].id}），无重复`)
}

async function main() {
  console.log(`检查 ${tag}（package.json version=${packageJson.version}）`)

  const meta = await request(`${downloadBase}/latest.yml`)
  if (meta.status !== 200) {
    problems.push(`latest.yml 不可下载（HTTP ${meta.status}）：${downloadBase}/latest.yml`)
    await checkDuplicateReleases()
    return
  }
  const yml = meta.body.toString('utf-8')

  const versionMatch = yml.match(/^version:\s*(\S+)/m)
  if (!versionMatch) {
    problems.push('latest.yml 里没有 version 字段')
  } else if (versionMatch[1] !== expectedVersion) {
    problems.push(`latest.yml 的 version 是 ${versionMatch[1]}，期望 ${expectedVersion}`)
  } else {
    passed.push(`latest.yml version=${versionMatch[1]}`)
  }

  const urls = [...yml.matchAll(/^\s*-\s*url:\s*(\S+)/gm)].map((match) => match[1])
  const sizes = [...yml.matchAll(/^\s*size:\s*(\d+)/gm)].map((match) => Number(match[1]))
  const pathMatch = yml.match(/^path:\s*(\S+)/m)
  const listed = urls.length ? urls : pathMatch ? [pathMatch[1]] : []
  if (!listed.length) problems.push('latest.yml 里没有列出任何产物')

  for (let i = 0; i < listed.length; i += 1) {
    const name = listed[i]
    const expectedSize = sizes[i]
    const file = await probeFile(name)
    if (file.status !== 200 && file.status !== 206) {
      problems.push(`${name} 不可下载（HTTP ${file.status}）`)
      continue
    }
    if (expectedSize && file.size && expectedSize !== file.size) {
      problems.push(`${name} 大小不符：latest.yml 记录 ${expectedSize}，实际 ${file.size}`)
    } else {
      passed.push(`${name} 可下载（${file.size} 字节）`)
    }
    const blockmap = await probeFile(`${name}.blockmap`)
    if (blockmap.status === 200 || blockmap.status === 206) {
      passed.push(`${name}.blockmap 存在，增量更新可用`)
    } else {
      warnings.push(`${name}.blockmap 缺失（HTTP ${blockmap.status}），将退化为整包下载`)
    }
  }

  await checkDuplicateReleases()
}

main()
  .catch((error) => {
    problems.push(`检查过程异常：${error.message}`)
  })
  .finally(() => {
    for (const line of passed) console.log(`  ✓ ${line}`)
    for (const line of warnings) console.warn(`  ! ${line}`)
    for (const line of problems) console.error(`  ✗ ${line}`)
    if (problems.length) {
      console.error(`\n${tag} 发布不完整：${problems.length} 个问题`)
      process.exitCode = 1
    } else {
      console.log(`\n${tag} 发布健康检查通过`)
    }
  })
