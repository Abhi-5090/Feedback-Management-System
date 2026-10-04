import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, test, expect, vi } from 'vitest';
import { Sidebar } from './AppShell.jsx';

/**
 * Log out must be reachable on a short screen.
 *
 * The rail was one flex column with no overflow handling. Twelve admin nav
 * items plus the brand and account blocks are taller than a laptop viewport,
 * so the bottom of the column — the account card and Log out — was clipped
 * away, and because scrollbars are suppressed product-wide there was nothing
 * to scroll with. The control that ends your session was simply absent.
 *
 * jsdom has no layout, so these assert the STRUCTURE that makes it reachable
 * rather than the pixels: the nav is the scrolling zone, and the account zone
 * is pinned outside it. Both are easy to undo by accident in a refactor, which
 * is exactly why they are pinned down here.
 */
const ADMIN_NAV = [
  'Dashboard', 'Feedbacks', 'Mentors', 'Compare', 'Cohorts', 'Classes',
  'Parameters', 'Batches', 'Phases', 'Audit trail', 'How it works', 'Settings',
].map((label, i) => ({ to: `/admin/${i}`, label, icon: 'dashboard' }));

const renderSidebar = (props = {}) =>
  render(
    <MemoryRouter>
      <Sidebar
        brand="Torii"
        roleLabel="Admin"
        nav={ADMIN_NAV}
        user={{ name: 'Abhishek Nallam', email: 'a@b.com' }}
        initials="AN"
        reduce
        onLogout={() => {}}
        {...props}
      />
    </MemoryRouter>
  );

describe('Sidebar', () => {
  test('renders log out alongside all twelve nav items', () => {
    renderSidebar();
    expect(screen.getByRole('button', { name: /log out/i })).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(ADMIN_NAV.length);
  });

  test('log out sits OUTSIDE the scrolling nav, in a pinned zone', () => {
    renderSidebar();
    const nav = screen.getByRole('navigation', { name: /main/i });
    const logout = screen.getByRole('button', { name: /log out/i });

    // If it ever moves back inside the scroll region it can scroll out of view.
    expect(nav.contains(logout)).toBe(false);

    // Its zone must refuse to shrink, or a long nav squeezes it to nothing.
    const zone = logout.closest('div.shrink-0');
    expect(zone).not.toBeNull();
    expect(zone.className).toMatch(/border-t/);
  });

  test('the nav is the zone that scrolls, and can shrink to allow it', () => {
    renderSidebar();
    const nav = screen.getByRole('navigation', { name: /main/i });
    expect(nav.className).toMatch(/overflow-y-auto/);
    /* min-h-0 on the wrapper is load-bearing: a flex child defaults to
       min-height:auto and will not shrink below its content, so overflow-y-auto
       alone would not scroll. */
    expect(nav.parentElement.className).toMatch(/min-h-0/);
    expect(nav.parentElement.className).toMatch(/flex-1/);
  });

  test('clicking log out calls the handler once', async () => {
    const onLogout = vi.fn();
    renderSidebar({ onLogout });
    await userEvent.click(screen.getByRole('button', { name: /log out/i }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  test('the account card still identifies who is signed in', () => {
    renderSidebar();
    expect(screen.getByText('Abhishek Nallam')).toBeInTheDocument();
    expect(screen.getByText('a@b.com')).toBeInTheDocument();
  });
});
