import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary.jsx';

/**
 * The boundary exists because a render error used to unmount the entire app,
 * leaving a white page with no message and no way out — indistinguishable from
 * the service being down. These tests pin the two behaviours that matter:
 * an ordinary error is EXPLAINED, and a stale-chunk error RECOVERS.
 */
const Boom = ({ error }) => {
  throw error;
};

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // React logs the caught error; silence it so the run stays readable.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    try {
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
  });

  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>All good</p>
      </ErrorBoundary>
    );
    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('explains an ordinary error instead of showing a blank page', () => {
    render(
      <ErrorBoundary>
        <Boom error={new Error('trainerLoad is not defined')} />
      </ErrorBoundary>
    );
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    // The message is surfaced so a bug report can name it.
    expect(screen.getByText(/trainerLoad is not defined/)).toBeInTheDocument();
    // And there is a way out.
    expect(screen.getByRole('button', { name: /Reload the page/i })).toBeInTheDocument();
  });

  it('recovers from a stale chunk by reloading once, not looping', () => {
    /* The reload is INJECTED rather than patched onto window.location.
       Deleting and reassigning location works on some jsdom/Node versions and
       throws a TypeError on others — it passed here and failed CI, which is
       the worst kind of test. */
    const reload = vi.fn();

    const staleChunk = new Error('Failed to fetch dynamically imported module: /assets/Batches-OLD.js');

    render(
      <ErrorBoundary onReload={reload}>
        <Boom error={staleChunk} />
      </ErrorBoundary>
    );

    // First encounter: reload, and say so rather than showing an error.
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Updating to the latest version/i)).toBeInTheDocument();

    // Second encounter inside the guard window: do NOT reload again — a chunk
    // that is genuinely gone would otherwise spin the tab forever.
    render(
      <ErrorBoundary onReload={reload}>
        <Boom error={staleChunk} />
      </ErrorBoundary>
    );
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/needs a refresh/i)).toBeInTheDocument();
  });
});
