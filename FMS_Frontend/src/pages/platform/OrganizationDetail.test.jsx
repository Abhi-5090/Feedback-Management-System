import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, test, expect, vi, beforeEach } from 'vitest';

const get = vi.fn();
const addAdmin = vi.fn();
const resetAdmin = vi.fn();
const update = vi.fn();

vi.mock('../../api/endpoints.js', () => ({
  PlatformAPI: {
    get: (...a) => get(...a),
    addAdmin: (...a) => addAdmin(...a),
    resetAdmin: (...a) => resetAdmin(...a),
    update: (...a) => update(...a),
  },
}));
vi.mock('../../platform/OrgScope.jsx', () => ({ useOrgScope: () => ({ setOrg: vi.fn() }) }));

const toast = { success: vi.fn(), error: vi.fn() };
vi.mock('../../components/Toast.jsx', () => ({ useToast: () => toast }));

const OrganizationDetail = (await import('./OrganizationDetail.jsx')).default;

const ORG = (over = {}) => ({
  organization: {
    id: 'o1', name: 'NCET', slug: 'ncet', status: 'active',
    admins: 1, trainers: 3, classes: 7, batches: 14, responses: 1259,
    createdAt: '2026-10-13T00:00:00.000Z', lastResponseAt: '2026-09-30T00:00:00.000Z',
    ...over,
  },
  admins: [
    { id: 'u1', name: 'Admin One', email: 'a1@ncet.test', role: 'admin', isActive: true, pendingFirstSignIn: false },
  ],
  trainers: [
    { id: 'u2', name: 'Mentor One', email: 'm1@ncet.test', role: 'trainer', isActive: true, pendingFirstSignIn: false },
  ],
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/platform/organizations/o1']}>
      <Routes>
        <Route path="/platform/organizations/:id" element={<OrganizationDetail />} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  get.mockReset().mockResolvedValue(ORG());
  addAdmin.mockReset();
  resetAdmin.mockReset();
  update.mockReset().mockResolvedValue({});
});

describe('organization detail', () => {
  test('shows the organization and its people', async () => {
    renderPage();
    expect(await screen.findByText('NCET')).toBeInTheDocument();
    expect(screen.getByText('Admin One')).toBeInTheDocument();
    expect(screen.getByText('Mentor One')).toBeInTheDocument();
  });

  test('flags an admin who has never signed in', async () => {
    /* The commonest reason an organization looks set up and is not. */
    get.mockResolvedValue({
      ...ORG(),
      admins: [{ id: 'u1', name: 'New Admin', email: 'n@x.test', role: 'admin', isActive: true, pendingFirstSignIn: true }],
    });
    renderPage();
    expect(await screen.findByText('Never signed in')).toBeInTheDocument();
  });

  test('warns when an organization has no admin at all', async () => {
    get.mockResolvedValue({ ...ORG({ admins: 0 }), admins: [] });
    renderPage();
    expect(await screen.findByText(/nobody can enter this organization/i)).toBeInTheDocument();
  });

  test('adding an admin shows the password exactly once', async () => {
    addAdmin.mockResolvedValue({
      admin: { id: 'u9', name: 'Second', email: 's@ncet.test' },
      temporaryPassword: 'Tmp-Passw0rd-xyz',
    });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /add admin/i }));
    /* Scoped to the dialog: the card's own "Add admin" button carries the same
       accessible name, and an unscoped query cannot tell the opener from the
       submit. */
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('Name'), 'Second');
    await userEvent.type(dialog.getByLabelText('Email'), 's@ncet.test');
    await userEvent.click(dialog.getByRole('button', { name: /^add admin$/i }));

    expect(await screen.findByText('Tmp-Passw0rd-xyz')).toBeInTheDocument();
    expect(screen.getByText(/cannot be shown again/i)).toBeInTheDocument();
  });

  test('a typed password is sent, and no secret is shown back', async () => {
    /* The operator already holds it. Showing it again would put a live
       credential on screen and in the response for nothing. */
    addAdmin.mockResolvedValue({
      admin: { id: 'u9', name: 'Second', email: 's@ncet.test', mustChangePassword: true },
    });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /add admin/i }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('Name'), 'Second');
    await userEvent.type(dialog.getByLabelText('Email'), 's@ncet.test');
    await userEvent.type(dialog.getByLabelText(/^Password/), 'Harbour-Lantern-42');
    await userEvent.click(dialog.getByRole('button', { name: /^add admin$/i }));

    await waitFor(() =>
      expect(addAdmin).toHaveBeenCalledWith('o1', expect.objectContaining({
        email: 's@ncet.test',
        password: 'Harbour-Lantern-42',
        requirePasswordChange: true,
      }))
    );
    expect(await screen.findByText(/sign in with the password you set/i)).toBeInTheDocument();
    expect(screen.queryByText(/cannot be shown again/i)).not.toBeInTheDocument();
  });

  test('leaving the password blank asks the server to generate one', async () => {
    addAdmin.mockResolvedValue({
      admin: { id: 'u9', name: 'Second', email: 's@ncet.test' },
      temporaryPassword: 'Gen-erated-1',
    });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /add admin/i }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('Name'), 'Second');
    await userEvent.type(dialog.getByLabelText('Email'), 's@ncet.test');
    await userEvent.click(dialog.getByRole('button', { name: /^add admin$/i }));

    await waitFor(() => expect(addAdmin).toHaveBeenCalled());
    // No `password` key at all, rather than an empty string the server must interpret.
    expect(addAdmin.mock.calls[0][1]).not.toHaveProperty('password');
    expect(await screen.findByText('Gen-erated-1')).toBeInTheDocument();
  });

  test('the force-change box can be turned off', async () => {
    addAdmin.mockResolvedValue({ admin: { id: 'u9', name: 'S', email: 's@ncet.test' } });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /add admin/i }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('Name'), 'Second');
    await userEvent.type(dialog.getByLabelText('Email'), 's@ncet.test');
    await userEvent.click(dialog.getByRole('checkbox'));
    await userEvent.click(dialog.getByRole('button', { name: /^add admin$/i }));

    await waitFor(() =>
      expect(addAdmin).toHaveBeenCalledWith('o1', expect.objectContaining({ requirePasswordChange: false }))
    );
  });

  test('a suspended organization says what suspension does, and blocks entry', async () => {
    get.mockResolvedValue(ORG({ status: 'suspended' }));
    renderPage();
    expect(await screen.findByText(/Nobody can sign in to this organization/i)).toBeInTheDocument();
    /* Suspension must read as reversible — the data is untouched — or nobody
       will use it when they should. */
    expect(screen.getByText(/does not delete anything/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open workspace/i })).toBeDisabled();
  });

  test('suspending asks the server for the new status', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /suspend/i }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('o1', { status: 'suspended' }));
  });
});
