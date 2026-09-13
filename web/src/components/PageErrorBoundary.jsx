import { Component } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

/**
 * Keeps one broken page from taking the whole application down.
 *
 * React unmounts the entire tree when a render throws. Without a boundary that
 * means a blank screen with no navigation — the person cannot even go back to
 * the screen they came from, which turns a single bad component into a total
 * outage.
 *
 * This sits inside the shell rather than around it, so the sidebar and header
 * survive: the rest of the platform stays reachable while one page is broken.
 */
export default class PageErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Left in the console deliberately: this is the one place a stack trace is
    // worth more than a tidy log.
    console.error('A page failed to render.', error, info?.componentStack);
  }

  componentDidUpdate(previous) {
    // Navigating somewhere else clears the failure, so the boundary does not
    // keep showing an error for a page the person has already left.
    if (this.state.error && previous.routeKey !== this.props.routeKey) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="mx-auto max-w-xl py-12 text-center">
        <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-alert/40 bg-alert/10">
          <AlertTriangle size={26} className="text-alert" />
        </span>

        <h1 className="font-display text-3xl text-ink">This page ran into a problem</h1>
        <p className="mt-2 text-sm text-ink-400">
          Nothing has been lost, and the rest of the platform is still working — use the menu to carry on
          somewhere else, or try this page again.
        </p>

        <pre className="mt-5 overflow-x-auto scroll-thin rounded-lg border border-line bg-surface-sunken px-4 py-3 text-left font-mono text-[11px] text-ink-400">
          {String(error?.message || error)}
        </pre>

        <div className="mt-5 flex justify-center gap-2">
          <button type="button" className="btn-gold" onClick={() => this.setState({ error: null })}>
            <RotateCcw size={14} /> Try again
          </button>
          <button type="button" className="btn-ghost" onClick={() => window.location.reload()}>
            Reload the app
          </button>
        </div>

        <p className="mt-4 text-xs text-ink-200">
          If it keeps happening, the message above is the useful part to report.
        </p>
      </div>
    );
  }
}
