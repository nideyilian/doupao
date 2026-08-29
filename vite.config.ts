/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import { readFileSync } from 'fs'
import { fileURLToPath, URL } from 'node:url'
import { normalizeDevProxyConfig } from './src/lib/devProxy'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

function loadDevProxyConfig() {
  try {
    return normalizeDevProxyConfig(
      JSON.parse(readFileSync('./dev-proxy.config.json', 'utf-8')) as unknown,
    )
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return null
    throw error
  }
}

export default defineConfig(({ command }) => {
  const devProxyConfig = command === 'serve' ? loadDevProxyConfig() : null

  return {
    plugins: [
      react(),
      electron([
        {
          entry: 'electron/main.ts',
          vite: {
            build: {
              outDir: 'dist-electron',
            },
          },
        },
        {
          entry: 'electron/preload.ts',
          onstart(args) {
            args.reload()
          },
          vite: {
            build: {
              outDir: 'dist-electron/electron',
              emptyOutDir: false,
              // preload 必须输出单一 CJS 格式（sandbox 下不支持 ESM import）。
              // 不用 build.lib.formats：vite 的 mergeConfig 对数组是拼接而非覆盖，
              // 会与 vite-plugin-electron 按 package.json "type":"module" 推导出的默认
              // formats:["es"] 合并成 ["es","cjs"]，导致两种格式竞争写同一文件并损坏产物。
              rollupOptions: {
                input: 'electron/preload.ts',
                output: [
                  {
                    format: 'cjs',
                    inlineDynamicImports: true,
                    entryFileNames: 'preload.cjs',
                  },
                ],
              },
            },
          },
        },
        {
          entry: 'electron/asset-indexer.ts',
          onstart() {},
          vite: {
            build: {
              outDir: 'dist-electron/electron',
              emptyOutDir: false,
              lib: {
                entry: 'electron/asset-indexer.ts',
                formats: ['es'],
                fileName: () => 'asset-indexer.js',
              },
            },
          },
        },
        {
          entry: 'electron/catalog-worker.ts',
          onstart() {},
          vite: {
            build: {
              outDir: 'dist-electron/electron',
              emptyOutDir: false,
              lib: {
                entry: 'electron/catalog-worker.ts',
                formats: ['es'],
                fileName: () => 'catalog-worker.js',
              },
            },
          },
        },
      ]),
    ],
    base: './',
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    test: {
      // jsdom（vitest 4）下 localStorage 缺失的最小 polyfill（见 vitest.setup.ts）
      setupFiles: [fileURLToPath(new URL('./vitest.setup.ts', import.meta.url))],
      // 固定测试时区为东八区：批次命名等按本地时间格式化（如 store.test.ts 的
      // 20260620-123456-batch-001），避免 CI（UTC）与本地（+8）结果不一致。
      env: { TZ: 'Asia/Shanghai' },
      // CI runner（2 核）上 fork worker 偶发崩溃（Worker exited unexpectedly）导致
      // 部分测试丢失，改为单进程串行执行保证发布流水线稳定。
      poolOptions: {
        forks: { singleFork: true },
      },
    },
    // 只从根 index.html 扫描依赖，避免把 dist-verify/、release/ 里的
    // 同名 index.html 当作多入口，导致 dep-scan 对无关目录报解析错误。
    optimizeDeps: {
      entries: [fileURLToPath(new URL('./index.html', import.meta.url))],
    },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __DEV_PROXY_CONFIG__: JSON.stringify(devProxyConfig),
    },
    server: {
      // Keep one exact development origin so Electron localStorage/IndexedDB
      // cannot drift to another project bound on a different loopback address.
      host: '127.0.0.1',
      port: 41731,
      strictPort: true,
      proxy:
        devProxyConfig?.enabled
          ? {
              [devProxyConfig.prefix]: {
                target: devProxyConfig.target,
                changeOrigin: devProxyConfig.changeOrigin,
                secure: devProxyConfig.secure,
                rewrite: (path) =>
                  path.replace(
                    new RegExp(`^${devProxyConfig.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
                    '',
                  ),
              },
            }
          : undefined,
    },
  }
})
