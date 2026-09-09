import { Component } from 'react';
import Icon from './Icon.jsx';

/**
 * Is this error a stale code-split chunk rather than a bug?
 *
 * After a redeploy, the `index.html` a browser already has points at chunk
 * filenames that no longer exist — the hashes changed. Navigating to a lazily
 * loaded route then fails its dynamic import, and because that rejection
 * surfaces during render there is nothing to show: the Suspense fallback sits
 * there forever and the page is simply blank. That is exactly what /admin/batches
 * did after a deploy, with every chunk on the server present and correct.
 *
 * The strings differ per browser and bundler, hence the breadth.
 */
const isStaleChunk = (err) => {
  const text = `${err?.name || ''} ${err?.message || ''}`;
  return /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading CSS chunk/i.test(
    text
  );
};

/* One reload, not a loop. If the chunk is genuinely missing rather than stale,
   reloading again would spin forever, so the attempt is recorded for the tab.
   sessionStorage rather than a field: the reload discards all component state. */
const RELOAD_KEY = 'fms:chunk-reload-at';
const RELOAD_WINDOW_MS = 20_000;

/**
 * @param {() => void} doReload  How to reload. Injected so this is testable
 *   without reassigning `window.location`, which is non-configurable in newer
 *   jsdom and Node — a test that deletes it passes on one version and throws a
 *   TypeError on the next, which is exactly how it broke CI while passing
 *   locally.
 */
function reloadOnceForStaleChunk(doReload) {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
  } catch {
    // Private mode can refuse storage; treat that as "not yet tried".
  }
  if (Date.now() - last < RELOAD_WINDOW_MS) return false;
  try {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
  // Re-requests index.html, which must revalidate, so the fresh chunk names
  // arrive with it.
  doReload();
  return true;
}

/**
 * Catches anything thrown while rendering the app and shows a way out.
 *
 * Without it React unmounts the whole tree on any render error, which is a
 * white page with nothing in it — no message, no button, nothing in the UI to
 * say what happened. That is the single worst failure mode a SPA has, because
 * it looks identical to the app being down.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, reloading: false };
    /* Default to a real reload; a test supplies its own. Bound once so the
       event listener can be removed by identity. */
    this.reload = props.onReload || (() => window.location.reload());
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidMount() {
    /* Vite reports a failed module preload through this event, which fires
       BEFORE any render error and is the cleanest signal that the deployed
       bundle moved under us. Recovering here means the user often never sees a
       broken state at all. */
    this.onPreloadError = (event) => {
      event.preventDefault?.();
      if (!reloadOnceForStaleChunk(this.reload)) {
        this.setState({ error: event.payload || new Error('Failed to load part of the app') });
      }
    };
    window.addEventListener('vite:preloadError', this.onPreloadError);
  }

  componentWillUnmount() {
    window.removeEventListener('vite:preloadError', this.onPreloadError);
  }

  componentDidCatch(error, info) {
    if (isStaleChunk(error)) {
      if (reloadOnceForStaleChunk(this.reload)) {
        this.setState({ reloading: true });
        return;
      }
    }
    // Keep it in the console for whoever is debugging; the UI stays friendly.
    // eslint-disable-next-line no-console
    console.error('[app] render error', error, info?.componentStack);
  }

  render() {
    const { error, reloading } = this.state;
    if (!error && !reloading) return this.props.children;

    if (reloading) {
      return (
        <div className="grid min-h-screen place-items-center bg-surface p-6">
          <div className="flex items-center gap-3 text-sm text-muted">
            <span className="block h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
            Updating to the latest version…
          </div>
        </div>
      );
    }

    const stale = isStaleChunk(error);

    return (
      <div className="grid min-h-screen place-items-center bg-surface p-6">
        <div className="card w-full max-w-md p-6 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-amber-500/12 text-amber-700 dark:text-amber-400">
            <Icon name="alert" size={22} />
          </span>

          <h1 className="mt-4 text-base font-bold text-ink">
            {stale ? 'This page needs a refresh' : 'Something went wrong'}
          </h1>

          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            {stale
              ? 'The app was updated while this tab was open, so part of it could not load. Refreshing picks up the new version.'
              : 'This screen hit an unexpected error. Your data is safe — nothing was saved or changed.'}
          </p>

          {/* The message, not the stack. Enough for a bug report, not a wall of
              build output aimed at nobody in the room. */}
          {!stale && error?.message && (
            <p className="mt-3 break-words rounded-xl bg-surface-2 px-3 py-2 text-left font-mono text-[11px] leading-relaxed text-muted">
              {String(error.message).slice(0, 300)}
            </p>
          )}

          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button type="button" className="btn-primary" onClick={this.reload}>
              <Icon name="refresh" size={15} />
              Reload the page
            </button>
            {/* An assign, not a router navigate: the router is inside the tree
                that just failed, so its state cannot be trusted here. */}
            <button
              type="button"
              className="btn-outline"
              onClick={() => {
                window.location.href = '/';
              }}
            >
              Go to the start
            </button>
          </div>
        </div>
      </div>
    );
  }
}
