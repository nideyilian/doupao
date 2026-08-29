/**
 * vitest 全局 setup：当前 jsdom 版本（vitest 4）不提供 window.localStorage，
 * 而多个持久化 store（useAssetLibraryStore / composite storeV2 等）的 zustand
 * persist 中间件在模块加载时读取 window.localStorage —— 缺失会导致每次 setState
 * 抛「Cannot read properties of undefined (reading 'setItem')」。
 * 这里在测试文件模块求值之前安装最小 localStorage polyfill（仅 jsdom 环境缺失时）。
 */
if (typeof window !== 'undefined' && !window.localStorage) {
  const data = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return data.size
    },
    clear: () => void data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, String(value)),
  }
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
}
