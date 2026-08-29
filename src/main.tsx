import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import 'streamdown/styles.css'
import './index.css'
import './design-system/styles.css'
import './theme/styles/skins.css'
import { installMobileViewportGuards } from './lib/viewport'
import { installChunkLoadRecovery } from './lib/chunkRecovery'
import { bootstrapAppearance } from './theme/appearance'

// 在 React 渲染之前同步应用上次外观快照，消除首屏皮肤闪烁
bootstrapAppearance()

installMobileViewportGuards()
installChunkLoadRecovery()

const DesignSystemPreview = lazy(() => import('./design-system/DesignSystemPreview'))
const isDesignSystemPreview =
  import.meta.env.DEV && new URLSearchParams(window.location.search).get('design-system') === '1'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isDesignSystemPreview ? (
      <Suspense fallback={null}>
        <DesignSystemPreview />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
