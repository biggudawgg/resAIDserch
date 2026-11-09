import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  /** Change this (e.g. to the current path) to clear the error when the user navigates away. */
  resetKey?: string
}

interface State {
  error: Error | null
}

/** Without a boundary React unmounts the whole app on a render or effect error, leaving a blank screen. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page crashed:', error, info.componentStack)
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="crash" role="alert">
        <AlertTriangle className="crash-icon" aria-hidden />
        <h2 className="crash-title">This page hit an error</h2>
        <p className="crash-body">The rest of the app still works. Reloading usually fixes it.</p>
        <code className="crash-detail">{error.message}</code>
        <button type="button" className="btn btn-primary btn-md" onClick={() => window.location.reload()}>
          <RefreshCw aria-hidden /> Reload page
        </button>
      </div>
    )
  }
}
