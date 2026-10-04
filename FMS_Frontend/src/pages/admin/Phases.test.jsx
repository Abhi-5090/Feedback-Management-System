import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

/**
 * The Phases page.
 *
 * The first version of this page had no visible way to create a phase. The
 * cause was a one-letter prop slip — `actions` passed to a PageHeader that
 * takes `action` — and React drops an unknown prop SILENTLY: the page
 * rendered, the build passed, and AllPages.test.jsx passed too, because a
 * page with a missing button still mounts without throwing.
 *
 * A mount test cannot catch that. These assert the page's primary ACTIONS
 * exist and work, which is the only thing that would have.
 */

const PHASE = {
  _id: 'ph1', name: 'Phase 1 — September 2026', code: 'P1',
  startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-10-01T00:00:00.000Z',
  status: 'closed', notes: '', closedAt: '2026-10-01T00:00:00.000Z',
  overdue: false, collecting: false,
  responses: 1259, batches: 14, average: 4.3,
  firstAt: '2026-09-09T00:00:00.000Z', lastAt: '2026-09-30T00:00:00.000Z',
};

const state = { phases: [PHASE], unassigned: { responses: 0, firstAt: null, lastAt: null } };

vi.mock('../../api/endpoints.js', () => ({
  PhasesAPI: {
    list: vi.fn(() => Promise.resolve(state)),
    current: vi.fn(() => Promise.resolve(null)),
    get: vi.fn(() => Promise.resolve(PHASE)),
    create: vi.fn(() => Promise.resolve({ phase: PHASE, claimed: 0 })),
    update: vi.fn(() => Promise.resolve({ phase: PHASE, claimed: 0, releasedFromThis: 0 })),
    close: vi.fn(() => Promise.resolve({ phase: PHASE, batchesLocked: 2 })),
    remove: vi.fn(() => Promise.resolve({ ok: true })),
  },
}));

import Phases from './Phases.jsx';
import { PhasesAPI } from '../../api/endpoints.js';
import { ToastProvider } from '../../components/Toast.jsx';

const renderPage = async () => {
  render(
    <MemoryRouter>
      <ToastProvider>
        <Phases />
      </ToastProvider>
    </MemoryRouter>
  );
  /* findAll, not find: an overdue phase legitimately names itself twice —
     once in the nudge banner and once in its row — and the singular query
     throws on more than one match. */
  await screen.findAllByText('Phase 1 — September 2026');
};

beforeEach(() => {
  state.phases = [PHASE];
  state.unassigned = { responses: 0, firstAt: null, lastAt: null };
  vi.clearAllMocks();
});

describe('creating a phase', () => {
  it('offers a "New phase" button — the page had none at all', async () => {
    await renderPage();
    expect(screen.getByRole('button', { name: /new phase/i })).toBeInTheDocument();
  });

  it('opens a form pre-filled with the CURRENT month and the next number', async () => {
    /* The common case should need a name and nothing else: an admin creating a
       phase has almost always just started collecting. */
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /new phase/i }));

    const dialog = await screen.findByRole('dialog');
    const now = new Date();
    const month = now.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
    expect(within(dialog).getByDisplayValue(new RegExp(`Phase 2 — ${month}`))).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('P2')).toBeInTheDocument();
  });

  it('shows a month grid so the admin picks the month they are collecting in', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /new phase/i }));
    const dialog = await screen.findByRole('dialog');

    const grid = within(dialog).getByRole('group', { name: /choose a month/i });
    expect(within(grid).getAllByRole('button')).toHaveLength(12);
    expect(within(grid).getByRole('button', { name: 'Nov' })).toBeInTheDocument();
  });

  it('picking a month fills the whole month', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /new phase/i }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Nov' }));
    expect(within(dialog).getByText(/Whole month/i)).toBeInTheDocument();
    // Shown inclusively: 30 Nov, not the exclusive 1 Dec the server stores.
    expect(within(dialog).getByText(/2026-11-01 → 2026-11-30/)).toBeInTheDocument();
  });

  it('submits the window the picker produced', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /new phase/i }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Nov' }));
    await user.click(within(dialog).getByRole('button', { name: /create phase/i }));

    await waitFor(() => expect(PhasesAPI.create).toHaveBeenCalledTimes(1));
    const body = PhasesAPI.create.mock.calls[0][0];
    expect(body.startsAt).toBe('2026-11-01T00:00:00.000Z');
    // Half-open: November ends at the instant December starts.
    expect(body.endsAt).toBe('2026-12-01T00:00:00.000Z');
  });
});

describe('adjusting the dates when collection runs over', () => {
  it('offers an Adjust control, because a month will eventually not be enough', async () => {
    /* The September exercise spanned 21 days and finished ON the 30th. Start a
       week later and the tail lands in the next month; without this the
       exercise would split across two phases. */
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /new phase/i }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Nov' }));
    await user.click(within(dialog).getByRole('button', { name: /adjust/i }));
    expect(within(dialog).getByLabelText(/first day/i)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/last day/i)).toBeInTheDocument();
  });

  it('extending the last day past the month end sends the right window', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /new phase/i }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Nov' }));
    await user.click(within(dialog).getByRole('button', { name: /adjust/i }));
    // "collection ran to 8 December"
    fireChange(within(dialog).getByLabelText(/last day/i), '2026-12-08');
    await user.click(within(dialog).getByRole('button', { name: /create phase/i }));

    await waitFor(() => expect(PhasesAPI.create).toHaveBeenCalled());
    const body = PhasesAPI.create.mock.calls[0][0];
    expect(body.startsAt).toBe('2026-11-01T00:00:00.000Z');
    /* The user typed 8 December and the phase must COVER that day, so the
       exclusive end is the 9th. Off by one here silently drops the last day's
       responses out of the phase. */
    expect(body.endsAt).toBe('2026-12-09T00:00:00.000Z');
    expect(within(dialog).queryByText(/Whole month/i)).not.toBeInTheDocument();
  });
});

describe('the rest of the page', () => {
  it('lists each phase with its figures', async () => {
    await renderPage();
    expect(screen.getByText('P1')).toBeInTheDocument();
    // Twice by design: the strip total and the row.
    expect(screen.getAllByText('1,259').length).toBeGreaterThan(0);
    expect(screen.getByText('4.30')).toBeInTheDocument();
  });

  it('a CLOSED phase offers no edit, close or delete', async () => {
    await renderPage();
    expect(screen.queryByRole('button', { name: /^close$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit Phase 1/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete Phase 1/i })).not.toBeInTheDocument();
  });

  it('a DRAFT phase offers "Start collecting"', async () => {
    state.phases = [{ ...PHASE, status: 'draft', responses: 0, closedAt: null }];
    await renderPage();
    expect(screen.getByRole('button', { name: /start collecting/i })).toBeInTheDocument();
  });

  it('an OVERDUE phase is nudged, not closed automatically', async () => {
    /* Auto-close would eventually lock a batch while a class is mid-form. */
    state.phases = [{ ...PHASE, status: 'open', overdue: true, collecting: false, closedAt: null }];
    await renderPage();
    expect(screen.getByText(/passed its end date/i)).toBeInTheDocument();
    expect(PhasesAPI.close).not.toHaveBeenCalled();
  });

  it('unassigned feedback is surfaced, not hidden', async () => {
    state.unassigned = { responses: 42, firstAt: '2026-12-01T00:00:00.000Z', lastAt: '2026-12-05T00:00:00.000Z' };
    await renderPage();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('closing asks first, and says what it will do', async () => {
    state.phases = [{ ...PHASE, status: 'open', collecting: true, closedAt: null }];
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /^close$/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument();
    expect(PhasesAPI.close).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: /close phase/i }));
    await waitFor(() => expect(PhasesAPI.close).toHaveBeenCalledWith('ph1'));
  });
});

/** Date inputs are controlled; a single change is deterministic where typing is not. */
function fireChange(el, value) {
  fireEvent.change(el, { target: { value } });
}

describe('date display', () => {
  it('shows the INCLUSIVE last day, in UTC', async () => {
    /* The window is [1 Sep 00:00Z, 1 Oct 00:00Z). The last day the phase
       actually covers is 30 September — and formatting the inclusive end
       (30 Sep 23:59:59.999Z) in local time turns it into 1 October for any
       reader east of Greenwich, which reads as though October is included. */
    await renderPage();
    expect(screen.getByText(/1 Sept 2026 – 30 Sept 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/– 1 Oct 2026/)).not.toBeInTheDocument();
  });
});
