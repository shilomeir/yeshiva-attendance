import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Optional fallback override; default is the Hebrew "טען מחדש" card. */
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * Top-level React Error Boundary (master plan R-49).
 *
 * Catches render-time exceptions anywhere in the tree below and renders a
 * Hebrew fallback card with a "טען מחדש" reload button instead of a blank
 * screen. componentDidCatch is the only place we surface to telemetry
 * (currently console.error only — no telemetry pipeline exists yet).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Last-resort logging. Once a telemetry pipeline exists, route here.
    // We intentionally keep this single console.error — it's the boundary's
    // job to surface what crashed the tree, and a blank screen is worse.
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  handleReload = () => {
    // Full reload is the safe path — local state might be corrupt; this
    // re-runs hydration (authStore, deviceToken, persisted Zustand slices).
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children
    if (this.props.fallback) return this.props.fallback
    return (
      <div
        dir="rtl"
        className="min-h-screen flex items-center justify-center bg-[var(--bg)] p-4"
      >
        <div className="max-w-md w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center flex flex-col gap-4">
          <div className="mx-auto h-12 w-12 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center text-red-600 dark:text-red-400 text-2xl">!</div>
          <h2 className="text-xl font-bold text-[var(--text)]">משהו השתבש</h2>
          <p className="text-sm text-[var(--text-muted)]">
            המסך נכשל בטעינה. רענן את הדף כדי לנסות שוב — הנתונים שלך לא נפגעו.
          </p>
          {this.state.error?.message && (
            <p className="text-[10px] text-[var(--text-muted)] font-mono bg-[var(--bg-2)] rounded p-2 break-words text-start">
              {this.state.error.message}
            </p>
          )}
          <button
            onClick={this.handleReload}
            className="rounded-lg bg-[var(--blue)] py-2 px-4 text-sm font-semibold text-white hover:opacity-90"
          >
            טען מחדש
          </button>
        </div>
      </div>
    )
  }
}
