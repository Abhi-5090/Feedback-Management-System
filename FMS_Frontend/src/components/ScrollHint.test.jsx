import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ScrollHint from './ScrollHint.jsx';

/**
 * jsdom reports every element as 0x0, so the fade and the "Swipe" nudge never
 * activate here — which is fine. What this guards is that the component mounts
 * and renders its children, because it now wraps five tables across the app and
 * a mistake in any of them blanks that page rather than failing a build.
 */
describe('ScrollHint', () => {
  it('renders its children', () => {
    render(
      <ScrollHint>
        <table>
          <tbody>
            <tr>
              <td>Industry Readiness Batch - 3</td>
            </tr>
          </tbody>
        </table>
      </ScrollHint>
    );
    expect(screen.getByText('Industry Readiness Batch - 3')).toBeInTheDocument();
  });

  it('shows no affordance when the content fits', () => {
    // 0x0 in jsdom means scrollWidth === clientWidth, i.e. not overflowing.
    render(<ScrollHint><div>short</div></ScrollHint>);
    expect(screen.queryByText(/swipe/i)).not.toBeInTheDocument();
  });
});
