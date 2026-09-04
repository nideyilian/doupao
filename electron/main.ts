import { app, BrowserWindow, Menu, nativeImage, session, shell, Tray, type WebContents } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { autoUpdater } from 'electron-updater'
import { registerIpcHandlers, initLocalSavePath, setLibraryKernelHooks } from './ipc-handlers'
import { registerApiTransport } from './api-transport'
import { handleChecked } from './ipc-guard'
import { decideRendererRecovery } from './renderer-crash-recovery'
import { AssetKernelManager, registerAssetScheme } from './asset-kernel'
import { runAssetMcpServer } from './asset-mcp'
import { getLibraryPaths, resolveCatalogDbPath, resolveCatalogDbPathFor } from './library-paths'
import { migrateCatalogIntoLibrary } from './catalog-migration'
import { ensureStateFileReadable, migrateLegacyAppDataIfNeeded } from './legacy-data-migration'
import { isTrustedRendererUrl } from './trusted-renderer'
import { loadApiSecrets, saveApiSecrets } from './secure-api-secrets'
import { LibraryImageWatcher } from './library-image-watcher'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow: BrowserWindow | null = null
let pendingReleaseNotes: unknown
let rendererSafeMode = false
let rendererCrashTimestamps: number[] = []
let assetKernel: AssetKernelManager | null = null
const libraryImageWatcher = new LibraryImageWatcher()
let assetKernelCloseInitiated = false
// 更新安装流程自身会触发 quit；此时不应拦截 before-quit 等待 sqlite 关闭，
// 否则 app.exit() 会跳过 electron-updater 的安装步骤。
let quittingForUpdateInstall = false
let tray: Tray | null = null
/** 关闭窗口时最小化到系统托盘（渲染端设置，持久化在 local-settings.json） */
let closeToTray = false
/** before-quit 置位：真正的退出不应被“关闭到托盘”拦截 */
let isQuitting = false

const LOCAL_SETTINGS_FILE = 'local-settings.json'

function readLocalSettings(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path.join(app.getPath('userData'), LOCAL_SETTINGS_FILE), 'utf-8')) as Record<
      string,
      unknown
    >
  } catch {
    return {}
  }
}

function writeLocalSettings(settings: Record<string, unknown>): void {
  writeFileSync(path.join(app.getPath('userData'), LOCAL_SETTINGS_FILE), JSON.stringify(settings, null, 2), 'utf-8')
}

function showMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  } else {
    createWindow()
  }
}

function createTray(): void {
  if (tray || !appIcon || appIcon.isEmpty()) return
  tray = new Tray(appIcon)
  tray.setToolTip('DOUPAO Image')
  const menu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => showMainWindow() },
    { type: 'separator' },
    { label: '退出 DOUPAO', click: () => app.quit() },
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => showMainWindow())
}

// 单实例锁：双开时两个进程会并发写同一 sqlite（WAL）与设置文件，存在竞态/损坏风险。
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const deepLink = findDeepLinkArgv(argv)
    if (deepLink) {
      dispatchDeepLink(deepLink)
      return
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

/** doupao:// 深链接：open?assetId= / search?q= / import?path= / collection?id= / tag?id=（URL 编码） */
type DeepLinkPayload =
  | { kind: 'open'; assetId: string }
  | { kind: 'search'; query: string }
  | { kind: 'import'; path: string }
  | { kind: 'collection'; collectionId: string }
  | { kind: 'tag'; tagId: string }

function findDeepLinkArgv(argv: string[]): string | null {
  return argv.find((arg) => arg.startsWith('doupao://')) ?? null
}

function parseDeepLink(raw: string): DeepLinkPayload | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'doupao:') return null
    if (url.hostname === 'open') {
      const assetId = url.searchParams.get('assetId')
      return assetId ? { kind: 'open', assetId } : null
    }
    if (url.hostname === 'search') {
      const query = url.searchParams.get('q') ?? url.searchParams.get('query')
      return query ? { kind: 'search', query } : null
    }
    if (url.hostname === 'import') {
      const path = url.searchParams.get('path')
      return path ? { kind: 'import', path } : null
    }
    if (url.hostname === 'collection') {
      const id = url.searchParams.get('id') ?? url.searchParams.get('collectionId')
      return id ? { kind: 'collection', collectionId: id } : null
    }
    if (url.hostname === 'tag') {
      const id = url.searchParams.get('id') ?? url.searchParams.get('tagId')
      return id ? { kind: 'tag', tagId: id } : null
    }
    return null
  } catch {
    return null
  }
}

function dispatchDeepLink(raw: string): void {
  const payload = parseDeepLink(raw)
  if (!payload) return
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send('app:deep-link', payload)
  }
}

registerAssetScheme()

// ===== 窗口状态持久化 =====

const WINDOW_STATE_FILE = 'window-state.json'
let windowStateSaveTimer: ReturnType<typeof setTimeout> | null = null

function loadWindowState(): { x?: number; y?: number; width?: number; height?: number } | null {
  try {
    const content = readFileSync(path.join(app.getPath('userData'), WINDOW_STATE_FILE), 'utf-8')
    const parsed = JSON.parse(content) as { x?: unknown; y?: unknown; width?: unknown; height?: unknown }
    if (!parsed || typeof parsed !== 'object') return null
    const state: { x?: number; y?: number; width?: number; height?: number } = {}
    if (typeof parsed.x === 'number') state.x = parsed.x
    if (typeof parsed.y === 'number') state.y = parsed.y
    if (typeof parsed.width === 'number' && parsed.width >= 800) state.width = parsed.width
    if (typeof parsed.height === 'number' && parsed.height >= 600) state.height = parsed.height
    return state.x !== undefined || state.y !== undefined || state.width !== undefined || state.height !== undefined
      ? state
      : null
  } catch {
    return null
  }
}

function saveWindowState(window: BrowserWindow) {
  try {
    const bounds = window.getNormalBounds()
    writeFileSync(
      path.join(app.getPath('userData'), WINDOW_STATE_FILE),
      JSON.stringify({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }),
      'utf-8',
    )
  } catch (error) {
    console.error('[window-state-save-failed]', error)
  }
}

function scheduleWindowStateSave(window: BrowserWindow) {
  if (windowStateSaveTimer) clearTimeout(windowStateSaveTimer)
  windowStateSaveTimer = setTimeout(() => {
    windowStateSaveTimer = null
    if (!window.isDestroyed()) saveWindowState(window)
  }, 500)
}

// 导航/弹窗防护：AI 渲染的 markdown 链接可能把主窗口导航到任意页面，
// 此时 preload 仍挂在 webContents 上，远程页面会获得全部 IPC 能力。
function hardenWebContents(contents: WebContents) {
  contents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault()
  })
  contents.setWindowOpenHandler(({ url }) => {
    // 新窗口一律拒绝；http(s) 链接交给系统浏览器打开。
    let parsed: URL | null = null
    try {
      parsed = new URL(url)
    } catch {
      parsed = null
    }
    if (parsed && (parsed.protocol === 'https:' || parsed.protocol === 'http:')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
}

app.on('web-contents-created', (_event, contents) => {
  hardenWebContents(contents)
})

const iconPath = path.join(__dirname, '../dist/icon.ico')
const appIcon = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined

autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true
// 允许预发布版本以跳过 getLatestTagName 的 406 错误
// 实际版本均为稳定版，无影响
autoUpdater.allowPrerelease = true

// 配置 GitHub 作为更新源
autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'nideyilian',
  repo: 'doupao',
})

function sendToWindow(channel: string, ...args: unknown[]) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

function watchLibraryImages(root = getLibraryPaths().root) {
  libraryImageWatcher.start(root, (file) => sendToWindow('library:image-file-removed', file))
}

function recordRendererCrash(details: { reason: string; exitCode: number }, safeMode: boolean) {
  try {
    const diagnosticsDir = path.join(app.getPath('userData'), 'diagnostics')
    mkdirSync(diagnosticsDir, { recursive: true })
    appendFileSync(
      path.join(diagnosticsDir, 'renderer-crashes.jsonl'),
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        reason: details.reason,
        exitCode: details.exitCode,
        safeMode,
      })}\n`,
      'utf-8',
    )
  } catch (error) {
    console.error('[renderer-crash-log-failed]', error)
  }
}

autoUpdater.on('checking-for-update', () => {
  sendToWindow('update:status', { status: 'checking' })
})

autoUpdater.on('update-available', (info) => {
  pendingReleaseNotes = info.releaseNotes
  sendToWindow('update:status', { status: 'available', version: info.version, releaseNotes: info.releaseNotes })
})

autoUpdater.on('update-not-available', (info) => {
  pendingReleaseNotes = undefined
  sendToWindow('update:status', { status: 'not-available', version: info.version })
})

autoUpdater.on('download-progress', (progressInfo) => {
  sendToWindow('update:status', {
    status: 'downloading',
    progress: progressInfo.percent,
    transferred: progressInfo.transferred,
    total: progressInfo.total,
    speed: progressInfo.bytesPerSecond,
  })
})

autoUpdater.on('update-downloaded', (info) => {
  sendToWindow('update:status', {
    status: 'downloaded',
    version: info.version,
    releaseNotes: info.releaseNotes ?? pendingReleaseNotes,
  })
})

autoUpdater.on('error', (error) => {
  pendingReleaseNotes = undefined
  const rawMessage = error?.message || String(error)
  console.error('[autoUpdater] error:', rawMessage)

  // 将技术错误转换为用户友好的中文提示
  let friendlyMessage = rawMessage
  if (rawMessage.includes('Cannot find latest.yml') || rawMessage.includes('latest.yml')) {
    friendlyMessage = '未找到更新文件，可能还没有发布新版本'
  } else if (rawMessage.includes('404')) {
    friendlyMessage = '未找到更新资源，请稍后重试'
  } else if (rawMessage.includes('406')) {
    friendlyMessage = '服务器拒绝了请求，请检查网络或稍后再试'
  } else if (rawMessage.includes('403')) {
    friendlyMessage = '访问被拒绝，可能是请求过于频繁'
  } else if (rawMessage.includes('429')) {
    friendlyMessage = '请求过于频繁，请稍后再试'
  } else if (/50[0-9]/.test(rawMessage)) {
    friendlyMessage = '更新服务器暂时不可用，请稍后重试'
  } else if (rawMessage.includes('422')) {
    friendlyMessage = '更新请求格式错误，请检查发布配置'
  } else if (
    rawMessage.includes('ECONNREFUSED') ||
    rawMessage.includes('ETIMEDOUT') ||
    rawMessage.includes('ENOTFOUND') ||
    rawMessage.includes('ENETUNREACH')
  ) {
    friendlyMessage = '网络连接失败，请检查网络后重试'
  } else if (rawMessage.includes('certificate') || rawMessage.includes('CERT')) {
    friendlyMessage = '网络证书验证失败，请检查网络环境'
  } else if (rawMessage.includes('redirect') || rawMessage.includes('redirected')) {
    friendlyMessage = '更新地址发生跳转，请稍后重试'
  } else if (rawMessage.length > 120) {
    // 对于未识别的长错误，截断并提示用户
    friendlyMessage = '更新服务暂时不可用，请稍后重试'
  }

  sendToWindow('update:status', { status: 'error', message: friendlyMessage })
})

function createWindow() {
  // dev 与 prod 统一使用构建产物 preload，避免仓库内过时 preload.cjs 造成行为漂移。
  const preloadPath = path.join(__dirname, '../dist-electron/electron/preload.cjs')
  const savedWindowState = loadWindowState()

  mainWindow = new BrowserWindow({
    ...(savedWindowState
      ? { x: savedWindowState.x, y: savedWindowState.y, width: savedWindowState.width, height: savedWindowState.height }
      : { width: 1400, height: 900 }),
    minWidth: 800,
    minHeight: 600,
    title: 'DOUPAO Image',
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#1a1a2e',
    icon: appIcon,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: false,
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.webContents.on('preload-error', (_event, preloadPath, err) => {
    console.error('[preload-error] 加载失败:', preloadPath, err)
  })

  mainWindow.webContents.on('console-message', (_event, ...args: unknown[]) => {
    // Electron 32+ 的 webContents console-message 以 MessageDetails 对象取代旧的位置参数
    // （本版本 electron.d.ts 仍声明旧签名），这里两种形态都兼容，避免旧代码
    // 在 message 为 undefined 时于主进程抛出 TypeError。
    const first = args[0]
    const message =
      first && typeof first === 'object' && 'message' in first
        ? String((first as { message?: unknown }).message)
        : typeof first === 'string'
          ? first
          : ''
    if (message && (message.includes('electronAPI') || message.includes('preload'))) {
      console.log(`[renderer] ${message}`)
    }
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer-crash]', details.reason, details.exitCode)
    const now = Date.now()
    rendererCrashTimestamps = [...rendererCrashTimestamps.filter((timestamp) => now - timestamp <= 60_000), now]
    const decision = decideRendererRecovery(rendererCrashTimestamps, now)
    rendererSafeMode = decision.reload && decision.safeMode
    recordRendererCrash(details, rendererSafeMode)
    if (decision.reload && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.reload()
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      // 退避上限：60s 内崩溃 ≥3 次，不再自动重启，改为加载内置错误页
      console.error('[renderer-crash] 崩溃过于频繁，停止自动恢复')
      mainWindow.loadURL(
        'data:text/html;charset=utf-8,' +
          encodeURIComponent(
            '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>DOUPAO 已停止</title>' +
              '<style>body{font-family:system-ui;background:#1a1a2e;color:#e5e7eb;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}' +
              'div{text-align:center;padding:24px}h1{font-size:20px}p{color:#9ca3af;font-size:14px}</style></head>' +
              '<body><div><h1>界面多次崩溃，已停止自动恢复</h1>' +
              '<p>请重启应用。若问题持续出现，请检查系统资源占用。</p></div></body></html>',
          ),
      )
    }
  })

  mainWindow.on('unresponsive', () => {
    console.error('[window-unresponsive]')
  })

  // 窗口尺寸/位置变化与关闭时持久化（防抖 500ms），下次启动恢复
  mainWindow.on('resize', () => scheduleWindowStateSave(mainWindow!))
  mainWindow.on('move', () => scheduleWindowStateSave(mainWindow!))
  mainWindow.on('close', (event) => {
    if (closeToTray && !isQuitting) {
      // 关闭到托盘：隐藏窗口而非退出，渲染进程（日程/Agent）继续运行
      event.preventDefault()
      mainWindow?.hide()
      return
    }
    if (windowStateSaveTimer) {
      clearTimeout(windowStateSaveTimer)
      windowStateSaveTimer = null
    }
    if (mainWindow && !mainWindow.isDestroyed()) saveWindowState(mainWindow)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

process.on('uncaughtException', (error) => {
  console.error('[main-uncaughtException]', error)
})

process.on('unhandledRejection', (reason) => {
  console.error('[main-unhandledRejection]', reason)
})

app.whenReady().then(async () => {
  // 旧版本数据迁移与状态文件兜底恢复：必须在窗口/渲染进程（IndexedDB）创建之前执行，
  // 否则新 userData 下"看不到"旧版本任何数据（词条库、标签工作区、收藏夹、素材库等）。
  // 迁移逻辑自身已尽量容错，这里再加一层保护，任何异常都不允许阻断应用启动。
  try {
    migrateLegacyAppDataIfNeeded()
    ensureStateFileReadable()
  } catch (error) {
    console.error('[legacy-data-migration] 启动迁移失败（已跳过，不影响启动）:', error)
  }
  if (process.argv.includes('--asset-mcp')) {
    migrateCatalogIntoLibrary()
    await runAssetMcpServer(resolveCatalogDbPath(), path.join(app.getPath('userData'), 'asset-api.json'))
    return
  }
  initLocalSavePath()
  registerIpcHandlers()
  registerApiTransport()

  // CSP：dev 与打包版统一注入同一份策略（仅 connect-src 追加 ws: 供 HMR WebSocket）。
  // 这样打包版才暴露的问题（如 connect-src 缺 data: 导致参考图转 Blob 报 Failed to fetch）
  // 在本地开发时即可发现，避免「开发正常、发布翻车」。dev 下如需临时关闭可设 DOUPAO_DEV_NO_CSP=1。
  // 宽松项说明：style-src 'unsafe-inline'（React 内联样式）、font-src 两个远程字体 CDN
  // （index.css 的 HarmonyOS Sans SC）、connect-src 含 data:（参考图/遮罩经 data URL
  // 转 Blob 需要 fetch(data:)）、script-src 'unsafe-inline'（dev 的 React Fast Refresh preamble）。
  const isDevServer = Boolean(process.env.VITE_DEV_SERVER_URL)
  const applyCsp = !isDevServer || process.env.DOUPAO_DEV_NO_CSP !== '1'
  if (applyCsp) {
    // 仅 script-src 有差异：dev 需 'unsafe-inline'（React Fast Refresh preamble 内联脚本），
    // 生产保持 'self' 严格模式；img/connect/font 等其余指令两版完全一致。
    const connectSrc = isDevServer ? "'self' ws: http: https: data:" : "'self' https: http: data:"
    const scriptSrc = isDevServer ? "'self' 'unsafe-inline'" : "'self'"
    const csp = [
      "default-src 'self'",
      `script-src ${scriptSrc}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: doupao:",
      "font-src 'self' data: https://fontsapi.zeoseven.com https://cdn.jsdelivr.net",
      `connect-src ${connectSrc}`,
      "media-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'none'",
    ].join('; ')
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [csp],
        },
      })
    })
  }

  handleChecked('app:get-startup-mode', () => ({ safeMode: rendererSafeMode }))

  handleChecked('app:get-close-to-tray', () => closeToTray)

  handleChecked('app:set-close-to-tray', (_event, payload: { enabled?: unknown }) => {
    closeToTray = payload?.enabled === true
    const settings = readLocalSettings()
    settings.closeToTray = closeToTray
    writeLocalSettings(settings)
    if (closeToTray) createTray()
    return closeToTray
  })

  handleChecked('update:check', async () => {
    try {
      await autoUpdater.checkForUpdates()
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  handleChecked('update:download', async () => {
    try {
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  handleChecked('update:install', () => {
    quittingForUpdateInstall = true
    autoUpdater.quitAndInstall(false, true)
    return { success: true }
  })

  handleChecked('app:get-version', () => {
    return app.getVersion()
  })

  handleChecked('settings:load-api-secrets', () => loadApiSecrets())

  handleChecked('settings:save-api-secrets', (_event, secrets: unknown) => saveApiSecrets(secrets))

  assetKernel = new AssetKernelManager(() => mainWindow)
  try {
    await assetKernel.initialize()
  } catch (error) {
    console.error('[asset-kernel-init-failed]', error)
  }
  setLibraryKernelHooks({
    close: () => {
      libraryImageWatcher.close()
      return assetKernel?.close() ?? Promise.resolve()
    },
    open: async (root) => {
      await (assetKernel?.reopenCatalog(resolveCatalogDbPathFor(root)) ?? Promise.resolve())
      watchLibraryImages(root)
    },
  })
  // 注册为 doupao:// 协议默认处理程序（Windows/Linux 需要在 ready 后调用）
  try {
    app.setAsDefaultProtocolClient('doupao')
  } catch (error) {
    console.warn('[deep-link] 注册 doupao:// 协议失败', error)
  }
  // macOS：open-url 事件携带协议 URL
  app.on('open-url', (event, url) => {
    event.preventDefault()
    dispatchDeepLink(url)
  })
  // 启动时恢复“关闭到托盘”设置（local-settings.json 持久化）
  closeToTray = readLocalSettings().closeToTray === true
  createWindow()
  watchLibraryImages()
  if (closeToTray) createTray()
  // 启动参数携带的深链接（Windows/Linux 双击关联文件/命令行唤起；需窗口就绪后分发）
  const startupDeepLink = findDeepLinkArgv(process.argv)
  if (startupDeepLink) dispatchDeepLink(startupDeepLink)

  if (!process.env.VITE_DEV_SERVER_URL) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {})
    }, 5000)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else {
      showMainWindow()
    }
  })
})

app.on('before-quit', () => {
  isQuitting = true
  libraryImageWatcher.close()
  tray?.destroy()
  tray = null
})

app.on('before-quit', (event) => {
  // 正常退出前等待 sqlite 关闭，避免 WAL 数据未落盘；更新安装流程不拦截。
  if (!assetKernel || assetKernelCloseInitiated || quittingForUpdateInstall) return
  assetKernelCloseInitiated = true
  event.preventDefault()
  void assetKernel.close().finally(() => {
    assetKernel = null
    app.exit()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
