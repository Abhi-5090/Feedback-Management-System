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
    expect(screen.queryByLabelText('Organization')).not.toBeInTheDocument();
  });

  test('a super admin starts on the platform view and can choose a tenant', async () => {
    currentUser = { role: 'superadmin' };
    renderWith(<><OrgSwitcher /><Probe /></>);

    await waitFor(() => expect(screen.getByLabelText('Organization')).toBeInTheDocument());
    expect(screen.getByTestId('probe')).toHaveTextContent('true||true');

    await userEvent.selectOptions(screen.getByLabelText('Organization'), 'o1');
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('true|o1|false'));
    expect(setOrganizationHeader).toHaveBeenLastCalledWith('o1');
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

  test('a suspended organization is labelled in the picker', async () => {
    currentUser = { role: 'superadmin' };
    renderWith(<OrgSwitcher />);
    await waitFor(() => expect(screen.getByLabelText('Organization')).toBeInTheDocument());
    expect(screen.getByRole('option', { name: /Other Institute — suspended/ })).toBeInTheDocument();
  });
});
