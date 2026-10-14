import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, test, expect, vi, beforeEach } from 'vitest';

const organizations = vi.fn();
const overview = vi.fn();
vi.mock('../../api/endpoints.js', () => ({
  PlatformAPI: {
    organizations: () => organizations(),
    overview: () => overview(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock('../../platform/OrgScope.jsx', () => ({ useOrgScope: () => ({ setOrg: vi.fn() }) }));
const toast = { success: vi.fn(), error: vi.fn() };
vi.mock('../../components/Toast.jsx', () => ({ useToast: () => toast }));
vi.mock('../../platform/apiBuild.js', () => ({
  fetchApiBuild: async () => ({ commit: '36e3fe5', branch: 'main' }),
  isMissingFeature: (e) => e?.status === 404,
}));

const ROW = (over = {}) => ({
  id: 'o1', name: 'NCET', slug: 'ncet', status: 'active',
  people: 26, classes: 7, batches: 14, openBatches: 0,
  responses: 1259, responsesLast30: 0, averageRating: 4.3,
  daysSinceLastResponse: 5, health: 'active', ...over,
});
const OVERVIEW = (over = {}) => ({
  kpis: {
    organizations: 1, suspended: 0, users: 26, batches: 14, openBatches: 0,
    responses: 1259, responsesLast30: 0, dormant: 0, neverUsed: 0, ...over,
  },
});

const Organizations = (await import('./Organizations.jsx')).default;
const renderPage = () => render(<MemoryRouter><Organizations /></MemoryRouter>);

beforeEach(() => {
  organizations.mockReset();
  overview.mockReset();
  toast.error.mockReset();
});

describe('Organizations', () => {
  test('lists what the server returns', async () => {
    organizations.mockResolvedValue({ organizations: [ROW()] });
    overview.mockResolvedValue(OVERVIEW());
    renderPage();
    expect(await screen.findByText('NCET')).toBeInTheDocument();
  });

  test('a dormant tenant is marked as such, not just shown with a big number', async () => {
    /* Volume alone hides the customer about to leave: a large dormant
       institution looks healthiest of all when sorted by responses. */
    organizations.mockResolvedValue({
      organizations: [ROW({ health: 'dormant', daysSinceLastResponse: 120, responses: 9000 })],
    });
    overview.mockResolvedValue(OVERVIEW({ dormant: 1 }));
    renderPage();
    /* "Dormant" appears twice on purpose — once as the platform-wide count,
       once as this row's badge — so the query has to say which it means. */
    const row = (await screen.findByText('NCET')).closest('li');
    expect(within(row).getByText('Dormant')).toBeInTheDocument();
    expect(within(row).getByText(/4 months ago/)).toBeInTheDocument();
  });

  test('a tenant that never collected anything is called out separately', async () => {
    organizations.mockResolvedValue({
      organizations: [ROW({ health: 'never-used', responses: 0, averageRating: null, daysSinceLastResponse: null })],
    });
    overview.mockResolvedValue(OVERVIEW({ neverUsed: 1, responses: 0 }));
    renderPage();
    const row = (await screen.findByText('NCET')).closest('li');
    expect(within(row).getByText('Never used')).toBeInTheDocument();
    expect(within(row).getByText(/no responses yet/)).toBeInTheDocument();
  });

  test('an organization currently collecting says so', async () => {
    organizations.mockResolvedValue({ organizations: [ROW({ openBatches: 3 })] });
    overview.mockResolvedValue(OVERVIEW({ openBatches: 3 }));
    renderPage();
    expect(await screen.findByText(/3 collecting now/)).toBeInTheDocument();
  });

  test('a 404 is reported as an undeployed API, not as a broken page', async () => {
    /* The failure mode that cost real time: the screen is there, the button is
       there, and the request 404s — which reads as a bug in a feature that is
       working perfectly on a server that has not been given it yet. */
    const err = Object.assign(new Error('Request failed with status code 404'), { status: 404 });
    organizations.mockRejectedValue(err);
    overview.mockRejectedValue(err);

    renderPage();
    expect(await screen.findByText(/has not been deployed yet/i)).toBeInTheDocument();
    // Names the build that IS running, so the next step is obvious.
    expect(await screen.findByText('36e3fe5')).toBeInTheDocument();
    // And does not add a meaningless "Request failed with status code 404" toast.
    expect(toast.error).not.toHaveBeenCalled();
  });

  test('a real error still surfaces as an error', async () => {
    const err = Object.assign(new Error('Database unreachable'), { status: 500 });
    organizations.mockRejectedValue(err);
    overview.mockRejectedValue(err);
    renderPage();
    await screen.findByText(/Organizations/);
    expect(toast.error).toHaveBeenCalledWith('Database unreachable');
    expect(screen.queryByText(/has not been deployed yet/i)).not.toBeInTheDocument();
  });
});
