import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import AnimatedNumber from './AnimatedNumber.jsx';

const reduceMotion = vi.hoisted(() => ({ value: false }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => reduceMotion.value,
}));

/**
 * Drive requestAnimationFrame by hand so we can step the counter
 * deterministically instead of waiting on real frames.
 */
let now = 0;
let frames = [];

const flushFrames = (ms) => {
  now += ms;
  const due = frames;
  frames = [];
  act(() => {
    due.forEach(({ cb }) => cb(now));
  });
};

/** Run the animation past its full duration so it settles on the target. */
const settle = () => {
  for (let i = 0; i < 8 && frames.length; i++) flushFrames(1000);
};

beforeEach(() => {
  now = 0;
  frames = [];
  reduceMotion.value = false;
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (cb) => {
    const handle = ++id;
    frames.push({ handle, cb });
    return handle;
  });
  vi.stubGlobal('cancelAnimationFrame', (handle) => {
    frames = frames.filter((f) => f.handle !== handle);
  });
  vi.stubGlobal('performance', { now: () => now });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// The component renders a bare <span> and does NOT spread extra props, so
// there is no test id to hang on to — read the single rendered span instead.
let view;
const shown = () => view.container.querySelector('span').textContent;

describe('<AnimatedNumber />', () => {
  it('lands on the final value once the animation completes', () => {
    view = render(<AnimatedNumber value={42} />);
    settle();
    expect(shown()).toBe('42');
  });

  it('formats to the requested number of decimals', () => {
    view = render(<AnimatedNumber value={4.267} decimals={2} />);
    settle();
    expect(shown()).toBe('4.27');
  });

  /**
   * REGRESSION: the dashboards poll every ~8s. A poll returning an UNCHANGED
   * value must be a no-op — if it re-animated, every metric on the page would
   * visibly reset to 0 and count back up several times a minute.
   */
  it('does not re-animate when re-rendered with the same value', () => {
    const { rerender } = (view = render(<AnimatedNumber value={42} />));
    settle();
    expect(shown()).toBe('42');

    // Simulate three polls returning identical data.
    for (let i = 0; i < 3; i++) {
      rerender(<AnimatedNumber value={42} />);
      expect(shown()).toBe('42');
      // No frame was even scheduled — the effect short-circuits.
      expect(frames).toHaveLength(0);
    }
  });

  /**
   * Same guarantee, forced through the effect body: changing `duration` re-runs
   * the effect while the target stays put. Nothing may move — this is what
   * catches a regression in the `from === target` short-circuit itself, which
   * the dependency array alone would hide.
   */
  it('stays put when the effect re-runs with an unchanged target', () => {
    const { rerender } = (view = render(<AnimatedNumber value={42} duration={900} />));
    settle();
    expect(shown()).toBe('42');

    rerender(<AnimatedNumber value={42} duration={400} />);

    expect(shown()).toBe('42');
    expect(frames).toHaveLength(0);
  });

  it('does not re-animate when an equal value arrives as a string', () => {
    const { rerender } = (view = render(<AnimatedNumber value={42} />));
    settle();

    rerender(<AnimatedNumber value="42" />);

    expect(shown()).toBe('42');
    expect(frames).toHaveLength(0);
  });

  it('counts from the previous value, not from zero, when the value changes', () => {
    const { rerender } = (view = render(<AnimatedNumber value={41} />));
    settle();
    expect(shown()).toBe('41');

    rerender(<AnimatedNumber value={42} />);
    // One early frame: already between the old and new value, nowhere near 0.
    flushFrames(16);
    expect(Number(shown())).toBeGreaterThanOrEqual(41);
    expect(Number(shown())).toBeLessThanOrEqual(42);

    settle();
    expect(shown()).toBe('42');
  });

  it('renders the target immediately under reduced motion', () => {
    reduceMotion.value = true;
    view = render(<AnimatedNumber value={87} />);

    // No frames scheduled at all, and the final value is already on screen.
    expect(frames).toHaveLength(0);
    expect(shown()).toBe('87');
  });

  it('jumps straight to a changed value under reduced motion', () => {
    reduceMotion.value = true;
    const { rerender } = (view = render(<AnimatedNumber value={10} />));
    rerender(<AnimatedNumber value={99} />);

    expect(frames).toHaveLength(0);
    expect(shown()).toBe('99');
  });

  it('treats a non-numeric value as 0 rather than rendering NaN', () => {
    view = render(<AnimatedNumber value={undefined} />);
    settle();
    expect(shown()).toBe('0');
  });

  it('applies the className it is given', () => {
    view = render(<AnimatedNumber value={1} className="tnum" />);
    expect(view.container.querySelector('span')).toHaveClass('tnum');
  });
});
