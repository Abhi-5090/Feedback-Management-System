import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const setOrganizationHeader = vi.fn();
const overview = vi.fn();

vi.mock('../api/client.js', () => ({
  setOrganizationHeader: (...a) => setOrganizationHeader(...a),
  api: {},
}));
vi.mock('../api/endpoints.js', () => ({ PlatformAPI: { overview: () => overview() } }));

let currentUser = null;
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => ({ user: currentUser }) }));

const { OrgScopeProvider, useOrgScope } = await import('./OrgScope.jsx');
const OrgSwitcher = (await import('./OrgSwitcher.jsx')).default;

const ORGS = [
  { id: 'o1', name: 'NCET', slug: 'ncet', status: 'active' },
  { id: 'o2', name: 'Other Institute', slug: 'other', status: 'suspended' },
];

function Probe() {
  const { orgId, isPlatformView, isSuper } = useOrgScope();
  return <div data-testid="probe">{`${isSuper}|${orgId}|${isPlatformView}`}</div>;
}

const renderWith = (ui) =>
  render(
    <MemoryRouter>
      <OrgScopeProvider>{ui}</OrgScopeProvider>
    </MemoryRouter>
  );

beforeEach(() => {
  localStorage.clear();
  setOrganizationHeader.mockClear();
  overview.mockReset().mockResolvedValue({ organizations: ORGS, kpis: {} });
});
afterEach(() => { currentUser = null; });

describe('a locked account makes no requests at all', () => {
  test('a super admin on an issued password does not fetch the platform list', async () => {
    /* These providers sit ABOVE the router, so they render even while
       ProtectedRoute is showing the change-password screen. Every data route
       refuses a locked account, and the client reloads on that refusal — so a
       fetch here is not merely wasted, it is the first step of a reload loop
       that reads as the password screen flickering endlessly. */
    currentUser = { role: 'superadmin', mustChangePassword: true };
    renderWith(<Probe />);
    await waitFor(() => expect(setOrganizationHeader).toHaveBeenCalled());
    expect(overview).not.toHaveBeenCalled();
  });

  test('and sends no organization header while locked', async () => {
    currentUser = { role: 'superadmin', mustChangePassword: true };
    localStorage.setItem('fms.organization', 'o1');
    renderWith(<Probe />);
    await waitFor(() => expect(setOrganizationHeader).toHaveBeenCalledWith(undefined));
  });

  test('once unlocked, it fetches normally', async () => {
    currentUser = { role: 'superadmin', mustChangePassword: false };
    renderWith(<Probe />);
    await waitFor(() => expect(overview).toHaveBeenCalled());
  });
});

describe('organization scope', () => {
  test('a member never sets an organization header — their tenant is server-side', async () => {
    currentUser = { role: 'admin' };
    renderWith(<Probe />);
    await waitFor(() => expect(setOrganizationHeader).toHaveBeenCalled());
    /* The header is the super admin's tenant SELECTOR. If a member could send
       one, the client would be choosing the tenant, which is exactly what
       multi-tenancy must not allow. */
    expect(setOrganizationHeader).toHaveBeenCalledWith(undefined);
    expect(screen.getByTestId('probe')).toHaveTextContent('false||false');
  });

  test('a member sees no switcher at all', () => {
    currentUser = { role: 'trainer' };
    renderWith(<OrgSwitcher />);
    expect(screen.queryByRole('button', { name: /Organization:/ })).not.toBeInTheDocument();
  });

  test('a super admin starts on the platform view and can choose a tenant', async () => {
    currentUser = { role: 'superadmin' };
    renderWith(<><OrgSwitcher /><Probe /></>);

    const trigger = await screen.findByRole('button', { name: /Organization: All organizations/ });
    expect(screen.getByTestId('probe')).toHaveTextContent('true||true');

    /* The list is not in the document until it is opened — that is the point
       of the control. A tenant this consequential should not be changed by a
       stray scroll over a collapsed native select. */
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('option', { name: /NCET/ }));

    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('true|o1|false'));
    expect(setOrganizationHeader).toHaveBeenLastCalledWith('o1');
    /* Closes once chosen, rather than leaving the panel hanging open. Awaited
       because the exit animation keeps it mounted for a beat after the click. */
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  });

  test('it opens and chooses by keyboard alone', async () => {
    currentUser = { role: 'superadmin' };
    renderWith(<><OrgSwitcher /><Probe /></>);
    const trigger = await screen.findByRole('button', { name: /Organization:/ });

    trigger.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(await screen.findByRole('listbox')).toBeInTheDocument();

    await userEvent.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('true|o1|false'));
  });

  test('Escape closes it without changing anything', async () => {
    currentUser = { role: 'superadmin' };
    renderWith(<><OrgSwitcher /><Probe /></>);
    await userEvent.click(await screen.findByRole('button', { name: /Organization:/ }));
    expect(await screen.findByRole('listbox')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(screen.getByTestId('probe')).toHaveTextContent('true||true');
  });

  test('the choice survives a reload', async () => {
    localStorage.setItem('fms.organization', 'o2');
    currentUser = { role: 'superadmin' };
    renderWith(<Probe />);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('true|o2|false'));
  });

  test('a stored organization that no longer exists falls back to the platform view', async () => {
    /* Otherwise every request points at a tenant that is gone, and the super
       admin is stuck on an error with no obvious way out. */
    localStorage.setItem('fms.organization', 'deleted-org');
    currentUser = { role: 'superadmin' };
    renderWith(<Probe />);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('true||true'));
  });

  test('a suspended organization is marked, not silently identical', async () => {
    currentUser = { role: 'superadmin' };
    renderWith(<OrgSwitcher />);
    await userEvent.click(await screen.findByRole('button', { name: /Organization:/ }));
    const option = await screen.findByRole('option', { name: /Other Institute/ });
    expect(option).toHaveTextContent('Suspended');
  });

  test('the current organization is the one marked selected', async () => {
    localStorage.setItem('fms.organization', 'o1');
    currentUser = { role: 'superadmin' };
    renderWith(<OrgSwitcher />);
    await userEvent.click(await screen.findByRole('button', { name: /Organization: NCET/ }));
    const selected = await screen.findAllByRole('option', { selected: true });
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveTextContent('NCET');
  });
});
