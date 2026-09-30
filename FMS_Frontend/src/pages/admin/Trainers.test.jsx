import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

/**
 * Editing a mentor.
 *
 * The form sent only `name` and `email`, while the API has always accepted
 * `shortName` and `phone`. That is the quiet kind of gap: nothing errors, the
 * save succeeds, and the field the admin came to change is simply not in the
 * request. shortName matters more than it looks — it is the label the training
 * board uses and the name every export prints, so a mentor whose board name
 * changed could only be corrected by editing the roster file and re-importing.
 */
const TRAINER = {
  _id: 't1',
  name: 'Prasanth Kumar',
  shortName: 'Prasanth K',
  email: 'prasanth.k@ncetmail.com',
  phone: '',
  isActive: true,
  classCount: 2,
  mainClassCount: 2,
  supportClassCount: 0,
  deployment: 'Main',
};

vi.mock('../../api/endpoints.js', () => ({
  TrainersAPI: {
    list: vi.fn(() =>
      Promise.resolve({ trainers: [TRAINER], page: 1, pages: 1, total: 1 })
    ),
    create: vi.fn(() => Promise.resolve({})),
    update: vi.fn(() => Promise.resolve({})),
    setActive: vi.fn(() => Promise.resolve({})),
    resetLink: vi.fn(() => Promise.resolve({ resetUrl: 'x', trainer: {}, expiresInMinutes: 30 })),
    bulkPreview: vi.fn(() => Promise.resolve({ rows: [], summary: {} })),
    bulk: vi.fn(() => Promise.resolve({ created: [], skipped: [], summary: {} })),
  },
  ClassesAPI: { list: vi.fn(() => Promise.resolve({ classes: [], page: 1, pages: 1, total: 0 })) },
  downloadExport: vi.fn(),
}));

import Trainers from './Trainers.jsx';
import { TrainersAPI } from '../../api/endpoints.js';
import { ToastProvider } from '../../components/Toast.jsx';

const renderPage = async () => {
  render(
    <MemoryRouter>
      <ToastProvider>
        <Trainers />
      </ToastProvider>
    </MemoryRouter>
  );
  // The page renders a desktop table and a mobile card list, so the name
  // legitimately appears more than once.
  await screen.findAllByText('Prasanth Kumar');
};

// See the note in Batches.test.jsx: these inputs are controlled by one `form`
// object, and per-character typing races the state update.
const setField = (input, value) => fireEvent.change(input, { target: { value } });

beforeEach(() => vi.clearAllMocks());

describe('editing a mentor', () => {
  it('seeds the form with the short name and phone, not just name and email', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getAllByRole('button', { name: /Edit/i })[0]);
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByDisplayValue('Prasanth Kumar')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('prasanth.k@ncetmail.com')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('Prasanth K')).toBeInTheDocument();
  });

  it('sends the short name on save, so the export label can be corrected', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getAllByRole('button', { name: /Edit/i })[0]);
    const dialog = await screen.findByRole('dialog');

    setField(within(dialog).getByDisplayValue('Prasanth K'), 'Prashanth');
    await user.click(within(dialog).getByRole('button', { name: /Save|Update/i }));

    await waitFor(() => expect(TrainersAPI.update).toHaveBeenCalledTimes(1));
    const [id, patch] = TrainersAPI.update.mock.calls[0];
    expect(id).toBe('t1');
    expect(patch.shortName).toBe('Prashanth');
    expect(patch.name).toBe('Prasanth Kumar');
    // Blank means "keep the current one" — never send an empty password.
    expect(patch).not.toHaveProperty('password');
  });
});
