import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, test, expect, vi, beforeEach } from 'vitest';

const get = vi.fn();
const exportOrg = vi.fn();
const remove = vi.fn();
const addAdmin = vi.fn();
const resetAdmin = vi.fn();
const update = vi.fn();

vi.mock('../../api/endpoints.js', () => ({
  PlatformAPI: {
    get: (...a) => get(...a),
    addAdmin: (...a) => addAdmin(...a),
    resetAdmin: (...a) => resetAdmin(...a),
    update: (...a) => update(...a),
    exportOrg: (...a) => exportOrg(...a),
    remove: (...a) => remove(...a),
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

/* A fresh instance per test. The shared default carries pointer and keyboard
   state between tests, which is what made clicks inside an animated modal land
   intermittently rather than never — the worst kind of failure to chase. */
let user;

beforeEach(() => {
  user = userEvent.setup();
  get.mockReset().mockResolvedValue(ORG());
  addAdmin.mockReset();
  resetAdmin.mockReset();
  update.mockReset().mockResolvedValue({});
  exportOrg.mockReset().mockResolvedValue(new Blob(['{}']));
  remove.mockReset().mockResolvedValue({ organization: { name: 'NCET' } });
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
    await user.click(await screen.findByRole('button', { name: /add admin/i }));
    /* Scoped to the dialog: the card's own "Add admin" button carries the same
       accessible name, and an unscoped query cannot tell the opener from the
       submit. */
    const panel = await screen.findByRole('dialog');
    await within(panel).findByLabelText('Name');
    const dialog = within(panel);
    await fill(dialog, 'Name', 'Second');
    await fill(dialog, 'Email', 's@ncet.test');
    await user.click(dialog.getByRole('button', { name: /^add admin$/i }));

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
    await user.click(await screen.findByRole('button', { name: /add admin/i }));
    const panel = await screen.findByRole('dialog');
    await within(panel).findByLabelText('Name');
    const dialog = within(panel);
    await fill(dialog, 'Name', 'Second');
    await fill(dialog, 'Email', 's@ncet.test');
    await fill(dialog, /^Password/, 'Harbour-Lantern-42');
    await user.click(dialog.getByRole('button', { name: /^add admin$/i }));

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
    await user.click(await screen.findByRole('button', { name: /add admin/i }));
    const panel = await screen.findByRole('dialog');
    await within(panel).findByLabelText('Name');
    const dialog = within(panel);
    await fill(dialog, 'Name', 'Second');
    await fill(dialog, 'Email', 's@ncet.test');
    await user.click(dialog.getByRole('button', { name: /^add admin$/i }));

    await waitFor(() => expect(addAdmin).toHaveBeenCalled());
    // No `password` key at all, rather than an empty string the server must interpret.
    expect(addAdmin.mock.calls[0][1]).not.toHaveProperty('password');
    expect(await screen.findByText('Gen-erated-1')).toBeInTheDocument();
  });

  test('the force-change box can be turned off', async () => {
    addAdmin.mockResolvedValue({ admin: { id: 'u9', name: 'S', email: 's@ncet.test' } });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /add admin/i }));
    const panel = await screen.findByRole('dialog');
    await within(panel).findByLabelText('Name');
    const dialog = within(panel);
    await fill(dialog, 'Name', 'Second');
    await fill(dialog, 'Email', 's@ncet.test');
    await user.click(dialog.getByRole('checkbox'));
    await user.click(dialog.getByRole('button', { name: /^add admin$/i }));

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
    await user.click(await screen.findByRole('button', { name: /suspend/i }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('o1', { status: 'suspended' }));
  });
});


/**
 * Open the delete dialog and wait for its contents before interacting.
 *
 * The panel animates in, so the dialog element exists before the fields
 * inside it are settled. Acting too early set a value on a node React then
 * re-rendered, which showed up as a test passing alone and failing one run in
 * three.
 */
async function openDeleteDialog() {
  await user.click(await screen.findByRole('button', { name: /delete permanently/i }));
  const panel = await screen.findByRole('dialog');
  // findBy, not getBy: the panel animates in, so its contents appear a tick
  // after the element itself does. A retrying query is what makes that benign.
  await within(panel).findByLabelText(/type .* to confirm/i);
  return within(panel);
}

/**
 * Fill a controlled field in one event.
 *
 * NOT user.type. These fields are `required`, and one is `type="email"` —
 * jsdom enforces constraint validation, so a field left partly filled makes
 * the form refuse to submit SILENTLY. Character-by-character typing into a
 * freshly opened modal drops characters often enough to make that happen
 * about one run in four, and the symptom is "the button did nothing", which
 * points nowhere near the cause. One change event carries the whole value.
 */
async function fill(scope, label, value) {
  const field = scope.getByLabelText(label);
  fireEvent.change(field, { target: { value } });
  await waitFor(() => expect(field).toHaveValue(value));
  return field;
}

/** Set a controlled field and wait for React to have taken the value. */
async function setConfirm(dialog, value) {
  const field = dialog.getByLabelText(/type .* to confirm/i);
  fireEvent.change(field, { target: { value } });
  await waitFor(() => expect(field).toHaveValue(value));
  return field;
}

describe('leaving the platform', () => {
  test('delete is unavailable until the organization is suspended', async () => {
    /* Removal must be a second, deliberate decision taken after access was
       cut — never the first thing a misclick can reach. */
    renderPage();
    const btn = await screen.findByRole('button', { name: /delete permanently/i });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/deliberately a second, separate decision/i)).toBeInTheDocument();
  });

  test('once suspended, deletion still requires the handle typed back', async () => {
    get.mockResolvedValue(ORG({ status: 'suspended' }));
    renderPage();
    const dialog = await openDeleteDialog();
    const submit = dialog.getByRole('button', { name: /delete permanently/i });
    expect(submit).toBeDisabled();

    await setConfirm(dialog, 'wrong');
    expect(submit).toBeDisabled();

    await setConfirm(dialog, 'ncet');
    expect(submit).toBeEnabled();
  });

  test('the dialog says exactly what will be destroyed', async () => {
    /* A confirmation that does not name the cost is a confirmation nobody
       reads. */
    get.mockResolvedValue(ORG({ status: 'suspended' }));
    renderPage();
    const dialog = await openDeleteDialog();
    expect(dialog.getByText(/1,259/)).toBeInTheDocument();
    expect(dialog.getByText(/7 subjects/)).toBeInTheDocument();
  });

  test('confirming sends the handle to the server', async () => {
    get.mockResolvedValue(ORG({ status: 'suspended' }));
    renderPage();
    await user.click(await screen.findByRole('button', { name: /delete permanently/i }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText(/type .* to confirm/i), 'ncet');
    const submit = dialog.getByRole('button', { name: /delete permanently/i });
    // eslint-disable-next-line no-console
    const input = dialog.getByLabelText(/type .* to confirm/i);
    console.log('DEBUG input.value=', JSON.stringify(input.value), 'disabled=', submit.disabled,
      'dialogs=', document.querySelectorAll('[role=dialog]').length);
    await user.click(submit);
    // eslint-disable-next-line no-console
    console.log('DEBUG remove calls=', remove.mock.calls.length, 'toast.error=', toast.error.mock.calls);
    await waitFor(() => expect(remove).toHaveBeenCalledWith('o1', 'ncet'));
  });

  test('export is offered regardless of status, because it must precede deletion', async () => {
    renderPage();
    const btn = await screen.findByRole('button', { name: /export all data/i });
    expect(btn).toBeEnabled();
  });
});
