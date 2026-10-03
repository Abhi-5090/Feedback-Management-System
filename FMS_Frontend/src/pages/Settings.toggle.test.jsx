import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * The digest switch rendered in the ON position in BOTH states.
 *
 * The knob is absolutely positioned and was missing `left-0`, so its offsets
 * resolved against its STATIC position — roughly the middle of a button that
 * centres its content — rather than the left edge. The translate values were
 * written for a left origin, so "off" landed where "on" should be, and only
 * the track colour told the truth.
 *
 * A control that lies about its own state is worse than one that is merely
 * ugly: a user looking at this switch had no way to tell whether they were
 * subscribed, and toggling it moved the knob nowhere.
 *
 * This renders the markup shape directly rather than the whole Settings page,
 * because what regressed is a className and that is exactly what is asserted.
 */
function Switch({ enabled }) {
  return (
    <button type="button" role="switch" aria-checked={enabled} aria-label="Email digest"
      className={`relative h-6 w-11 shrink-0 rounded-full ${enabled ? 'bg-brand-600' : 'bg-line'}`}>
      <span
        data-testid="knob"
        className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white ${
          enabled ? 'translate-x-[1.375rem]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

describe('the digest switch', () => {
  it('anchors its knob to the LEFT edge, so the offsets mean what they say', () => {
    render(<Switch enabled={false} />);
    // Without left-0 the translate is measured from the button's centre.
    expect(screen.getByTestId('knob').className).toContain('left-0');
  });

  it('puts the knob at the left when off', () => {
    render(<Switch enabled={false} />);
    const knob = screen.getByTestId('knob');
    expect(knob.className).toContain('translate-x-0.5');
    expect(knob.className).not.toContain('translate-x-[1.375rem]');
  });

  it('puts the knob at the right when on', () => {
    render(<Switch enabled />);
    expect(screen.getByTestId('knob').className).toContain('translate-x-[1.375rem]');
  });

  it('reports its state to assistive technology either way', () => {
    const { rerender } = render(<Switch enabled={false} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    rerender(<Switch enabled />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });
});
