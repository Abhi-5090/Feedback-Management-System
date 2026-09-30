import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

/**
 * Editing a batch.
 *
 * The backend has accepted PATCH /batches/:id with a full class+mentor roster
 * since the multi-class migration; the page simply never called it. There was
 * no way to change a batch's name, its cohort, or who teaches it after
 * creation — you could only archive it and start again.
 *
 * These tests hold the two halves of that fix: that the form is SEEDED from
 * the batch (a blank edit form silently wipes the roster on save), and that
 * the open-batch rule is honoured client-side rather than by bouncing the
 * admin off a 400.
 */

/* Text fields are set with fireEvent.change rather than userEvent.type.
   These inputs are controlled by a single `form` object, and typing character
   by character races the state update: under load React re-renders between
   keystrokes and resets the input to the lagging state value, so an assertion
   on the final value passes alone and fails in a full run. One atomic change
   exercises the same handler without the race. */
const setField = (input, value) => fireEvent.change(input, { target: { value } });

const roster = (mainIds, supportIds) => ({
  mainTrainers: mainIds.map((id) => ({ id, name: id })),
  supportTrainers: supportIds.map((id) => ({ id, name: id })),
  mainTrainerNames: mainIds,
  supportTrainerNames: supportIds,
  mainTrainerIds: mainIds,
  supportTrainerIds: supportIds,
});

const BATCH = {
  _id: 'b1',
  name: 'AI Ready 2028 · Batch-2',
  yearGroup: 'Third Year',
  dept: 'AIML',
  status: 'locked',
  round: 2,
  expectedCount: 100,
  submittedCount: 66,
  hasPasscode: false,
  classCount: 2,
  mentorCount: 3,
  classes: [
    { id: 'c1', name: 'GenAI', ...roster(['t1'], ['t2']) },
    { id: 'c2', name: 'Coding', ...roster(['t2'], []) },
  ],
  archivedAt: null,
  createdAt: new Date().toISOString(),
};

const state = { batch: BATCH };

vi.mock('../../api/endpoints.js', () => ({
  BatchesAPI: {
    list: vi.fn(() =>
      Promise.resolve({
        batches: [state.batch],
        page: 1,
        pages: 1,
        total: 1,
        filters: { yearGroups: ['Third Year', 'Final Year'] },
      })
    ),
    create: vi.fn(() => Promise.resolve({})),
    update: vi.fn(() => Promise.resolve({})),
    unlock: vi.fn(() => Promise.resolve({ passcode: 'X', batch: {} })),
    lock: vi.fn(() => Promise.resolve({})),
    rotatePasscode: vi.fn(() => Promise.resolve({ passcode: 'X' })),
    rounds: vi.fn(() => Promise.resolve({ rounds: [] })),
    archive: vi.fn(() => Promise.resolve({})),
  },
  ClassesAPI: {
    list: vi.fn(() =>
      Promise.resolve({
        classes: [
          { _id: 'c1', name: 'GenAI', trainer: null },
          { _id: 'c2', name: 'Coding', trainer: null },
          { _id: 'c3', name: 'DS', trainer: null },
        ],
        page: 1, pages: 1, total: 3,
      })
    ),
  },
  TrainersAPI: {
    list: vi.fn(() =>
      Promise.resolve({
        trainers: [
          { _id: 't1', name: 't1', isActive: true },
          { _id: 't2', name: 't2', isActive: true },
          { _id: 't3', name: 't3', isActive: true },
        ],
        page: 1, pages: 1, total: 3,
      })
    ),
  },
  downloadExport: vi.fn(),
}));

import Batches from './Batches.jsx';
import { BatchesAPI } from '../../api/endpoints.js';
import { ToastProvider } from '../../components/Toast.jsx';

const renderPage = async () => {
  // The page reports every validation refusal through the toast context, so
  // without the provider `useToast()` is null and the failures under test
  // become crashes instead.
  render(
    <MemoryRouter>
      <ToastProvider>
        <Batches />
      </ToastProvider>
    </MemoryRouter>
  );
  await screen.findByText(BATCH.name);
};

/** Open the edit modal for the single batch on the page. */
const openEditor = async (user) => {
  await user.click(screen.getByRole('button', { name: /Edit this batch/i }));
  return screen.findByRole('dialog');
};

beforeEach(() => {
  state.batch = BATCH;
  vi.clearAllMocks();
});

describe('editing a batch', () => {
  it('offers an edit action on every batch row', async () => {
    await renderPage();
    expect(screen.getByRole('button', { name: /Edit this batch/i })).toBeInTheDocument();
  });

  it('seeds the form from the batch instead of opening blank', async () => {
    /* The failure this guards is silent and destructive: an edit form that
       opens empty and then PATCHes `classes: []` deletes the roster on a save
       the admin thought only renamed the batch. */
    const user = userEvent.setup();
    await renderPage();
    const dialog = await openEditor(user);

    expect(within(dialog).getByDisplayValue('AI Ready 2028 · Batch-2')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('Third Year')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('AIML')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('100')).toBeInTheDocument();
    expect(within(dialog).getByText(/selected/).textContent).toMatch(/^\s*2\s+selected/);
  });

  it('saves the full roster, translated back to the shape the server accepts', async () => {
    const user = userEvent.setup();
    await renderPage();
    const dialog = await openEditor(user);

    setField(
      within(dialog).getByDisplayValue('AI Ready 2028 · Batch-2'),
      'AI Ready 2028 · Batch-2 (revised)'
    );
    await user.click(within(dialog).getByRole('button', { name: /Save changes/i }));

    await waitFor(() => expect(BatchesAPI.update).toHaveBeenCalledTimes(1));
    const [id, body] = BatchesAPI.update.mock.calls[0];
    expect(id).toBe('b1');
    expect(body.name).toBe('AI Ready 2028 · Batch-2 (revised)');
    expect(body.yearGroup).toBe('Third Year');
    expect(body.expectedCount).toBe(100);
    // `{ id, mainTrainerIds }` on the wire becomes `{ class, mainTrainers }`.
    expect(body.classes).toEqual([
      { class: 'c1', mainTrainers: ['t1'], supportTrainers: ['t2'] },
      { class: 'c2', mainTrainers: ['t2'], supportTrainers: [] },
    ]);
  });

  it('refuses a cap below the responses already collected', async () => {
    /* The server refuses this too, with CAP_BELOW_SUBMITTED. Catching it here
       names the number the admin has to beat rather than bouncing them. */
    const user = userEvent.setup();
    await renderPage();
    const dialog = await openEditor(user);

    setField(within(dialog).getByDisplayValue('100'), '10');
    await user.click(within(dialog).getByRole('button', { name: /Save changes/i }));

    expect(await screen.findByText(/already has 66 responses/i)).toBeInTheDocument();
    expect(BatchesAPI.update).not.toHaveBeenCalled();
  });

  it('refuses to save a class left with no main mentor', async () => {
    const user = userEvent.setup();
    await renderPage();
    const dialog = await openEditor(user);

    // Add DS, which arrives unstaffed because it has no catalog default.
    await user.click(within(dialog).getByRole('button', { name: /DS/ }));
    await user.click(within(dialog).getByRole('button', { name: /Save changes/i }));

    expect(await screen.findByText(/needs at least one main mentor/i)).toBeInTheDocument();
    expect(BatchesAPI.update).not.toHaveBeenCalled();
  });
});

describe('editing a batch while collection is OPEN', () => {
  beforeEach(() => {
    state.batch = { ...BATCH, status: 'open', hasPasscode: true };
  });

  it('explains why the roster is fixed rather than failing on save', async () => {
    const user = userEvent.setup();
    await renderPage();
    const dialog = await openEditor(user);
    // Stated twice on purpose: once in the modal's description, once on the
    // section it actually governs.
    expect(within(dialog).getAllByText(/Collection is open/i).length).toBeGreaterThanOrEqual(2);
    expect(within(dialog).getByText(/Lock the batch first to edit them/i)).toBeInTheDocument();
  });

  it('OMITS classes from the payload, so the server guard is never tripped', async () => {
    /* Sending the unchanged array would still return 400 BATCH_OPEN — the
       server rejects the presence of the key, not a change in its value. */
    const user = userEvent.setup();
    await renderPage();
    const dialog = await openEditor(user);

    setField(within(dialog).getByDisplayValue('AIML'), 'CSE');
    await user.click(within(dialog).getByRole('button', { name: /Save changes/i }));

    await waitFor(() => expect(BatchesAPI.update).toHaveBeenCalledTimes(1));
    const [, body] = BatchesAPI.update.mock.calls[0];
    expect(body.dept).toBe('CSE');
    expect(body).not.toHaveProperty('classes');
  });

  it('still shows who is staffed, read-only', async () => {
    const user = userEvent.setup();
    await renderPage();
    const dialog = await openEditor(user);
    // The names are visible; the picker that would change them is not.
    expect(within(dialog).getAllByText('t1').length).toBeGreaterThan(0);
    expect(within(dialog).queryByRole('button', { name: /^DS$/ })).not.toBeInTheDocument();
  });
});
