import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import Icon, { ICON_NAMES, StarIcon } from './Icon.jsx';

describe('<Icon />', () => {
  it('renders an <svg> for a known name', () => {
    const { container } = render(<Icon name="users" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    // Decorative by default — it must not be announced.
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg.innerHTML).not.toBe('');
  });

  /**
   * A typo'd icon name must degrade to nothing, never crash the page it sits
   * on. This is the whole reason the lookup returns null instead of indexing
   * blindly into the path map.
   */
  it('renders nothing for an unknown name', () => {
    expect(render(<Icon name="definitelyNotAnIcon" />).container).toBeEmptyDOMElement();
  });

  it('renders nothing for a missing / empty name', () => {
    expect(render(<Icon />).container).toBeEmptyDOMElement();
    expect(render(<Icon name="" />).container).toBeEmptyDOMElement();
    expect(render(<Icon name={null} />).container).toBeEmptyDOMElement();
  });

  it('honours size, strokeWidth and className', () => {
    const { container } = render(
      <Icon name="star" size={20} strokeWidth={2} className="text-emerald-600" />
    );
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '20');
    expect(svg).toHaveAttribute('height', '20');
    expect(svg).toHaveAttribute('stroke-width', '2');
    expect(svg).toHaveClass('shrink-0', 'text-emerald-600');
  });

  it('exposes a non-empty ICON_NAMES list', () => {
    expect(Array.isArray(ICON_NAMES)).toBe(true);
    expect(ICON_NAMES.length).toBeGreaterThan(0);
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
  });

  it.each(ICON_NAMES)('renders "%s" without throwing', (name) => {
    const { container } = render(<Icon name={name} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    // Every entry must actually carry geometry, not an empty fragment.
    expect(svg.innerHTML.trim()).not.toBe('');
  });
});

describe('<StarIcon />', () => {
  it('renders filled with currentColor by default', () => {
    const { container } = render(<StarIcon />);
    expect(container.querySelector('svg')).toHaveAttribute('fill', 'currentColor');
  });

  it('renders hollow when filled is false', () => {
    const { container } = render(<StarIcon filled={false} />);
    expect(container.querySelector('svg')).toHaveAttribute('fill', 'none');
  });
});
