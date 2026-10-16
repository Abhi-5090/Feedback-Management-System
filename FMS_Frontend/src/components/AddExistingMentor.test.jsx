import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, test, expect, vi, beforeEach } from 'vitest';

const directory = vi.fn();
const addExisting = vi.fn();
vi.mock('../api/endpoints.js', () => ({
  TrainersAPI: { directory: (...a) => directory(...a), addExisting: (...a) => addExisting(...a) },
}));
const toast = { success: vi.fn(), error: vi.fn() };
vi.mock('./Toast.jsx', () => ({ useToast: () => toast }));

const AddExistingMentor = (await import('./AddExistingMentor.jsx')).default;

const PERSON = (over = {}) => ({
  id: 'u1', name: 'Meera Mentor', email: 'meera@elsewhere.test',
  shortName: 'Meera', alreadyHere: false, ...over,
});

let user;
const open = (props = {}) =>
  render(<AddExistingMentor open onClose={() => {}} onAdded={() => {}} {...props} />);

beforeEach(() => {
  user = userEvent.setup();
  directory.mockReset().mockResolvedValue({ people: [PERSON()] });
  addExisting.mockReset().mockResolvedValue({ addedExisting: true });
  toast.success.mockReset();
  toast.error.mockReset();
});

describe('finding an existing mentor', () => {
  test('asks for two characters before searching anything', async () => {
    /* A browsable roll of everybody is a bigger thing to put on screen than
       a lookup, and the task is always somebody you already know of. */
    open();
    expect(screen.getByText(/type at least two characters/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/search by name or email/i), { target: { value: 'm' } });
    await new Promise((r) => setTimeout(r, 300));
    expect(directory).not.toHaveBeenCalled();
  });

  test('searches once the term is long enough, and lists the match', async () => {
    open();
    fireEvent.change(screen.getByLabelText(/search by name or email/i), { target: { value: 'meera' } });
    await waitFor(() => expect(directory).toHaveBeenCalledWith('meera'));
    expect(await screen.findByText('Meera Mentor')).toBeInTheDocument();
    expect(screen.getByText('meera@elsewhere.test')).toBeInTheDocument();
  });

  test('somebody already here is marked, not offered again', async () => {
    directory.mockResolvedValue({ people: [PERSON({ alreadyHere: true })] });
    open();
    fireEvent.change(screen.getByLabelText(/search by name or email/i), { target: { value: 'meera' } });
    expect(await screen.findByText('Already here')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^add$/i })).not.toBeInTheDocument();
  });

  test('adding says their existing password still works', async () => {
    /* Otherwise an admin goes looking for a credential that was never
       issued. */
    open();
    fireEvent.change(screen.getByLabelText(/search by name or email/i), { target: { value: 'meera' } });
    await user.click(await screen.findByRole('button', { name: /^add$/i }));
    await waitFor(() => expect(addExisting).toHaveBeenCalledWith('u1'));
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/existing password/i));
  });

  test('no match points at the other path rather than dead-ending', async () => {
    directory.mockResolvedValue({ people: [] });
    open();
    fireEvent.change(screen.getByLabelText(/search by name or email/i), { target: { value: 'nobody' } });
    expect(await screen.findByText(/nobody on the platform matches/i)).toBeInTheDocument();
    expect(screen.getByText(/New mentor/)).toBeInTheDocument();
  });

  test('a slow earlier search cannot overwrite a newer one', async () => {
    /* Typing quickly fires several; without ordering, an earlier reply can
       land last and paint results for a term nobody is looking at. */
    let resolveFirst;
    directory
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = () => r({ people: [PERSON({ name: 'STALE Person' })] }); }))
      .mockImplementationOnce(() => Promise.resolve({ people: [PERSON({ name: 'Fresh Person' })] }));

    open();
    const field = screen.getByLabelText(/search by name or email/i);
    fireEvent.change(field, { target: { value: 'meera' } });
    await waitFor(() => expect(directory).toHaveBeenCalledTimes(1));
    fireEvent.change(field, { target: { value: 'meerab' } });
    await waitFor(() => expect(directory).toHaveBeenCalledTimes(2));

    expect(await screen.findByText('Fresh Person')).toBeInTheDocument();
    resolveFirst();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('STALE Person')).not.toBeInTheDocument();
    expect(screen.getByText('Fresh Person')).toBeInTheDocument();
  });
});
