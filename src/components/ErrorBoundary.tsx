import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] 捕获到未处理错误:', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-ds-surface dark:bg-ds-scrim p-8">
          <div className="max-w-md text-center">
            <div className="text-4xl mb-4">⚠</div>
            <h2 className="text-lg font-semibold text-ds-text dark:text-ds-text-subtle mb-2">应用遇到了一个错误</h2>
            <p className="text-sm text-ds-muted dark:text-ds-muted mb-4 font-mono break-all">
              {this.state.error?.message}
            </p>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, error: null })
                window.location.reload()
              }}
              className="px-5 py-2 rounded-lg bg-ds-primary hover:bg-ds-primary-hover text-ds-text-inverse text-sm font-medium transition-colors"
            >
              重新加载
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
