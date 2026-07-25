import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Modal from './Modal.jsx';

/**
 * Modal moves focus in on the next animation frame. In a browser that lands
 * ~16ms after open, long before anyone can type; in jsdom the frame would
 * otherwise fire mid-`user.type` and look like stolen focus. Await it once so
 * each test starts from the state a real user actually meets.
 */
const settleOpen = () =>
  act(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));

/**
 * framer-motion's AnimatePresence/motion work in jsdom but the exit animation
 * keeps unmounting nodes around, which makes "closed" assertions racy. Mock it
 * down to plain elements — this suite is about focus and keyboard behaviour,
 * not the transition.
 */
vi.mock('framer-motion', async () => {
  const { forwardRef, createElement } = await import('react');

  // The cache is load-bearing: without it the Proxy hands back a NEW component
  // identity on every property access, React treats each render as a different
  // component type, and the whole dialog subtree remounts every keystroke —
  // which would fake the exact bug this file is meant to catch.
  const cache = new Map();
  const componentFor = (tag) => {
    if (!cache.has(tag)) {
      cache.set(
        tag,
        // forwardRef so Modal's panelRef still points at a real DOM node and
        // the focus trap keeps working.
        forwardRef(({ children, initial, animate, exit, transition, ...rest }, ref) =>
          createElement(tag, { ...rest, ref }, children)
        )
      );
    }
    return cache.get(tag);
  };

  return {
    AnimatePresence: ({ children }) => children,
    motion: new Proxy({}, { get: (_, tag) => componentFor(tag) }),
  };
});

describe('<Modal />', () => {
  it('renders nothing when closed', () => {
    render(
      <Modal open={false} onClose={() => {}} title="Add trainer">
        <input aria-label="Name" />
      </Modal>
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders an accessible dialog with aria-modal and the title', () => {
    render(
      <Modal open onClose={() => {}} title="Add trainer" description="Fill in the details">
        <p>body</p>
      </Modal>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Add trainer');
    expect(screen.getByRole('heading', { name: 'Add trainer' })).toBeInTheDocument();
    expect(screen.getByText('Fill in the details')).toBeInTheDocument();
  });

  /**
   * REGRESSION: modal inputs accepted exactly one character.
   *
   * The focus effect used to depend on `onClose`. Callers pass an inline arrow,
   * so `onClose` was a fresh reference on every render — every keystroke
   * re-ran the effect and its focus-in step yanked the caret back, wiping the
   * in-progress value. The parent below re-renders on every keystroke (state
   * lives outside the modal) AND passes an inline onClose, which is precisely
   * the shape that used to break.
   */
  it('accepts a full multi-character string typed into an input', async () => {
    // A real delay between keystrokes is what makes this test meaningful: the
    // stolen-focus frame is a ~16ms rAF, so with userEvent's default 0ms delay
    // no frame ever lands mid-word and the bug stays invisible.
    const user = userEvent.setup({ delay: 20 });

    function Harness() {
      const [open, setOpen] = useState(true);
      const [value, setValue] = useState('');
      return (
        <Modal open={open} onClose={() => setOpen(false)} title="Add trainer">
          <input
            aria-label="Full name"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Modal>
      );
    }

    render(<Harness />);
    await settleOpen();

    const input = screen.getByLabelText('Full name');
    await user.type(input, 'Jane Doe');

    // Before the fix this was 'J' — the effect re-ran on the second keystroke
    // and pulled focus off the field mid-word.
    expect(input).toHaveValue('Jane Doe');
  });

  it('keeps focus on the field being typed into across renders', async () => {
    // A real delay between keystrokes is what makes this test meaningful: the
    // stolen-focus frame is a ~16ms rAF, so with userEvent's default 0ms delay
    // no frame ever lands mid-word and the bug stays invisible.
    const user = userEvent.setup({ delay: 20 });

    function Harness() {
      const [a, setA] = useState('');
      const [b, setB] = useState('');
      return (
        <Modal open onClose={() => {}} title="Two fields">
          <input aria-label="First" value={a} onChange={(e) => setA(e.target.value)} />
          <input aria-label="Second" value={b} onChange={(e) => setB(e.target.value)} />
        </Modal>
      );
    }

    render(<Harness />);
    await settleOpen();

    const second = screen.getByLabelText('Second');
    await user.type(second, 'hello world');

    // Focus must not have been stolen back to the first focusable node.
    expect(second).toHaveFocus();
    expect(second).toHaveValue('hello world');
    expect(screen.getByLabelText('First')).toHaveValue('');
  });

  it('calls onClose when Escape is pressed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Add trainer">
        <input aria-label="Name" />
      </Modal>
    );

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls the LATEST onClose on Escape, not the one bound at open', async () => {
    const user = userEvent.setup();
    const first = vi.fn();
    const latest = vi.fn();

    const { rerender } = render(
      <Modal open onClose={first} title="Add trainer">
        <input aria-label="Name" />
      </Modal>
    );
    rerender(
      <Modal open onClose={latest} title="Add trainer">
        <input aria-label="Name" />
      </Modal>
    );

    await user.keyboard('{Escape}');

    expect(latest).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('calls onClose from the close button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Add trainer">
        <p>body</p>
      </Modal>
    );

    await user.click(screen.getByRole('button', { name: 'Close dialog' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('locks background scroll while open and restores it on close', () => {
    const { rerender } = render(
      <Modal open onClose={() => {}} title="Add trainer">
        <p>body</p>
      </Modal>
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <Modal open={false} onClose={() => {}} title="Add trainer">
        <p>body</p>
      </Modal>
    );
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('traps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    render(
      <Modal open onClose={() => {}} title="Add trainer">
        <input aria-label="Name" />
        <button type="button">Save</button>
      </Modal>
    );

    screen.getByRole('button', { name: 'Save' }).focus();
    await user.tab();

    // Wrapped back into the dialog rather than escaping to document.body.
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement);
  });
});
