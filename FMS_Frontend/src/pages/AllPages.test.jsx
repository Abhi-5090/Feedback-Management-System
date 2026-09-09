import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

/**
 * Every page must MOUNT.
 *
 * A component that throws on render produces a blank screen, and `vite build`
 * cannot catch it — a bad identifier looks like a global, and broken JSX
 * nesting still compiles. Twice now that has reached production: `useLocation`
 * used without importing it, and then /admin/batches blanking after a refactor.
 * Both were invisible to the build and to every existing test.
 *
 * So this renders all 27 pages against stubbed APIs and fails on the first
 * exception. It asserts almost nothing about content on purpose: its whole job
 * is "does this page exist without throwing", which is the failure that
 * actually keeps happening.
 */

/* Charts measure their container, which jsdom reports as 0x0 and then warns
   about at length. They are not what is under test. */
vi.mock('../components/charts/ParamBarChart.jsx', () => ({ default: () => <div /> }));
vi.mock('../components/charts/TrendLineChart.jsx', () => ({ default: () => <div /> }));
vi.mock('../components/charts/VolumeBarChart.jsx', () => ({ default: () => <div /> }));

/* One stub for the whole API surface.
   Everything lives INSIDE the factory: vi.mock is hoisted above the file's
   top-level code, so a fixture defined outside is still uninitialised when the
   factory runs. Every call resolves to a shape the pages can render, so a crash
   is unambiguously the component's fault rather than a missing mock. */
vi.mock('../api/endpoints.js', () => {
  const ok = (v) => () => Promise.resolve(v);
  const paramRow = (label) => ({ parameterId: label, label, order: 0, average: 4.2, responses: 5 });
  const comment = (i) => ({
    id: `c${i}`, comment: `Comment number ${i} about the session`, average: 4,
    className: 'GenAI', batchName: 'AI Ready 2028 · Batch-2', classId: 'c1', batchId: 'b1',
    createdAt: new Date().toISOString(),
  });
  const roster = {
    mainTrainers: [{ id: 't1', name: 'Bhargava R' }],
    supportTrainers: [{ id: 't2', name: 'Jayanth M' }],
    mainTrainerNames: ['Bhargava R'], supportTrainerNames: ['Jayanth M'],
    mainTrainerIds: ['t1'], supportTrainerIds: ['t2'],
  };
  const session = {
    id: 'b1|c1', batchId: 'b1', batchName: 'AI Ready 2028 · Batch-2', yearGroup: 'Third Year',
    dept: 'AIML', status: 'locked', round: 2, classId: 'c1', className: 'GenAI',
    ...roster, myRoles: ['main'], responses: 66, average: 4.25,
    lastFeedbackAt: new Date().toISOString(), expectedCount: 100, submittedCount: 66,
    counterValue: 66, responseRate: 66,
    strongest: { label: 'Content clarity', average: 4.6 },
    weakest: { label: 'Pace of the session', average: 3.4 },
    openedAt: new Date().toISOString(),
  };
  const analytics = {
    feedbackCount: 132, overallAverage: 4.25, perParameter: [paramRow('Content clarity')],
    trend: [{ date: '2026-09-09', average: 4.25, responses: 66 }],
    comments: [comment(1), comment(2)], commentTotal: 132, commentPageSize: 50,
  };

  return {
    AuthAPI: {
      me: ok({ user: { _id: 'u1', name: 'Administrator', email: 'a@b.com', role: 'admin', mustChangePassword: false } }),
      login: ok({ user: {}, token: 't' }), logout: ok({ ok: true }), updateMe: ok({ user: {} }),
      forgotPassword: ok({ ok: true }), resetPassword: ok({ ok: true }),
    },
    TrainersAPI: {
      list: ok([{ _id: 't1', name: 'Bhargava R', shortName: 'Bhargav', email: 'b@n.com', phone: '', isActive: true, classCount: 4, mainClassCount: 4, supportClassCount: 0, deployment: 'Main' }]),
      create: ok({}), update: ok({}), setActive: ok({}), resetLink: ok({ resetUrl: 'x', trainer: {}, expiresInMinutes: 30 }),
      bulkPreview: ok({ rows: [], summary: {} }), bulk: ok({ created: [], skipped: [], summary: {} }),
    },
    ClassesAPI: {
      list: ok({ classes: [{ _id: 'c1', name: 'GenAI', description: '', batchCount: 3, openBatchCount: 0, mainMentors: [], supportMentors: [] }], page: 1, pages: 1, total: 1 }),
      create: ok({}), update: ok({}), archive: ok({}),
    },
    ParametersAPI: { list: ok([{ _id: 'p1', label: 'Content clarity', description: '', order: 0, isActive: true }]), create: ok({}), update: ok({}), remove: ok({}) },
    BatchesAPI: {
      list: ok({ batches: [{ _id: 'b1', name: 'AI Ready 2028 · Batch-2', yearGroup: 'Third Year', dept: 'AIML', status: 'locked', round: 2, expectedCount: 100, submittedCount: 66, hasPasscode: false, classCount: 2, mentorCount: 3, classes: [{ id: 'c1', name: 'GenAI', ...roster }], archivedAt: null, createdAt: new Date().toISOString() }], page: 1, pages: 1, total: 1, filters: { yearGroups: ['Third Year'] } }),
      create: ok({}), update: ok({}), unlock: ok({ passcode: 'X', batch: {} }), lock: ok({}),
      rotatePasscode: ok({ passcode: 'X' }), archive: ok({}),
    },
    AuditAPI: { list: ok({ entries: [], page: 1, pages: 1, total: 0, filters: { actions: [], actors: [] } }) },
    ClassesArchiveAPI: { archive: ok({}) },
    AnalyticsAPI: {
      classes: ok([{ id: 'c1', name: 'GenAI', description: '', isActive: true, trainer: null, batches: 3, openBatches: 0, responses: 66, average: 4.25, lastFeedbackAt: new Date().toISOString(), strongest: { label: 'A', average: 4.5 }, weakest: { label: 'B', average: 3.5 } }]),
      sessions: ok({ sessions: [session], filters: { yearGroups: ['Third Year'], classes: [{ id: 'c1', name: 'GenAI' }] } }),
      years: ok([{ yearGroup: 'Third Year', batchCount: 2, openBatches: 0, classCount: 2, subjects: ['Coding', 'GenAI'], departments: [], sessionCount: 4, students: 200, submitted: 66, responseRate: 33, responses: 132, average: 4.25, lastFeedbackAt: new Date().toISOString() }]),
      trainers: ok({ trainers: [{ id: 't1', name: 'Bhargava R', shortName: 'Bhargav', email: 'b@n.com', isActive: true, classes: 4, batches: 2, responses: 66, average: 4.25, lastFeedbackAt: null, perParameter: [{ label: 'Content clarity', average: 4.3 }] }], parameters: ['Content clarity'], role: 'all' }),
      cohorts: ok([{ yearGroup: 'Third Year', batches: 2, openBatches: 0, expected: 200, submitted: 66, responses: 132, average: 4.25, responseRate: 33 }]),
      mentorLoad: ok({ mentors: [{ id: 't1', name: 'Bhargava R', shortName: 'Bhargav', email: 'b@n.com', asMain: { classes: 4, batches: 2, responses: 66, average: 4.25 }, asSupport: { classes: 0, batches: 0, responses: 0, average: 0 }, totalClasses: 4, deployment: 'Main' }] }),
      themes: ok({ themes: [], analysed: 0, positive: [], negative: [] }),
      comments: ok({ comments: [comment(3)], total: 132, page: 2, pages: 3, limit: 50, term: '', context: null }),
      deltas: ok({ days: 30, current: { average: 4.2, responses: 60 }, previous: { average: 4.0, responses: 50 }, change: { average: 0.2, responses: 10, responsesPct: 20 } }),
      class: ok({ class: { id: 'c1', name: 'GenAI', description: '', defaultTrainer: null }, teams: [], ...analytics, breakdown: { consolidated: { yearGroupCount: 1, batchCount: 1, responses: 132, expected: 100, submitted: 66 }, yearGroups: [{ yearGroup: 'Third Year', batchCount: 1, openBatches: 0, responses: 132, average: 4.25, expected: 100, submitted: 66, responseRate: 66, lastFeedbackAt: null, perParameter: [paramRow('Content clarity')], batches: [{ id: 'b1', name: 'AI Ready 2028 · Batch-2', dept: 'AIML', status: 'locked', round: 2, expectedCount: 100, submittedCount: 66, responseRate: 66, responses: 132, average: 4.25, lastFeedbackAt: null, perParameter: [], ...roster }] }] } }),
      batch: ok({ collections: [{ round: 2, firstAt: new Date().toISOString(), lastAt: new Date().toISOString(), days: ['2026-09-09'], classCount: 2, rows: 132, responses: 66, average: 4.25 }], selectedRound: null, batch: { id: 'b1', name: 'AI Ready 2028 · Batch-2', yearGroup: 'Third Year', dept: 'AIML', round: 2, classes: [{ id: 'c1', name: 'GenAI', ...roster }], classCount: 1, submittedCount: 66, expectedCount: 100, status: 'locked' }, classesBreakdown: [{ id: 'c1', name: 'GenAI', ...roster, feedbackCount: 66, overallAverage: 4.25, perParameter: [paramRow('Content clarity')] }], ...analytics }),
      trainerMe: ok({ ...analytics, roleSplit: { main: { feedbackCount: 66, overallAverage: 4.25, role: 'main' }, support: { feedbackCount: 0, overallAverage: 0, role: 'support' } } }),
      trainerBatches: ok([{ id: 'b1', name: 'AI Ready 2028 · Batch-2', yearGroup: 'Third Year', dept: '', status: 'locked', round: 2, classes: [{ id: 'c1', name: 'GenAI', ...roster }], classCount: 1, mainClassCount: 1, supportClassCount: 0, submittedCount: 66, expectedCount: 100, responses: 66, average: 4.25, lastFeedbackAt: null, openedAt: null, createdAt: new Date().toISOString() }]),
      roleSplit: ok({ main: { feedbackCount: 66, overallAverage: 4.25 }, support: { feedbackCount: 0, overallAverage: 0 } }),
    },
    DashboardAPI: {
      admin: ok({ kpis: { trainers: 24, classes: 7, batches: 14, openBatches: 0, feedbackCount: 132, overallAverage: 4.25, expectedResponses: 1719, submittedResponses: 66, responseRate: 3.8 }, charts: { perParameter: [paramRow('Content clarity')], trend: [], volumePerClass: [] }, openBatchList: [], comments: [comment(1)], commentTotal: 132, commentPageSize: 50 }),
      trainerMe: ok({ kpis: { myClasses: 4, myBatches: 2, mainClasses: 4, supportClasses: 0, feedbackCount: 66, overallAverage: 4.25 }, roleSplit: { main: { feedbackCount: 66, overallAverage: 4.25 }, support: { feedbackCount: 0, overallAverage: 0 } }, charts: { perParameter: [paramRow('Content clarity')], trend: [], volumePerClass: [] }, openBatchList: [], comments: [comment(1)], commentTotal: 66, commentPageSize: 50 }),
    },
    PublicAPI: {
      verifyPasscode: ok({ ok: true, batchId: 'b1', batchName: 'B', yearGroup: '', dept: '', round: 1, classes: [{ id: 'c1', name: 'GenAI', description: '', mainMentors: ['Bhargava R'], supportMentors: [] }], parameters: [{ _id: 'p1', label: 'Content clarity', description: '', order: 0 }], full: false, sessionToken: 's' }),
      submitFeedback: ok({ ok: true, classesRecorded: 1, submittedCount: 1, expectedCount: 10 }),
    },
    SystemAPI: { status: ok({ mail: { mode: 'console', configured: false }, environment: 'test', transactions: true }), testMail: ok({ ok: true }), runDigests: ok({ ok: true }) },
    downloadExport: ok(undefined),
  };
});

import { ToastProvider } from '../components/Toast.jsx';
import { ThemeProvider } from '../theme/ThemeContext.jsx';
import { AuthProvider } from '../auth/AuthContext.jsx';

/** Mount one page at a route, inside the providers the real app supplies. */
async function mountPage(Component, { path = '/', route = '/' } = {}) {
  render(
    <MemoryRouter initialEntries={[route]}>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <Routes>
              <Route path={path} element={<Component />} />
            </Routes>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
  // Let the mount effects settle so an error thrown in one is attributed here.
  await waitFor(() => expect(document.body).toBeTruthy());
  await new Promise((r) => setTimeout(r, 0));
}

const PAGES = [
  ['Login', () => import('./Login.jsx')],
  ['ForgotPassword', () => import('./ForgotPassword.jsx')],
  ['ResetPassword', () => import('./ResetPassword.jsx')],
  ['NotFound', () => import('./NotFound.jsx')],
  ['ForcePasswordChange', () => import('./ForcePasswordChange.jsx')],
  ['Feedbacks', () => import('./Feedbacks.jsx')],
  ['Comments', () => import('./Comments.jsx')],
  ['Guide', () => import('./Guide.jsx')],
  ['Settings', () => import('./Settings.jsx')],
  ['admin/Dashboard', () => import('./admin/Dashboard.jsx')],
  ['admin/Trainers', () => import('./admin/Trainers.jsx')],
  ['admin/Classes', () => import('./admin/Classes.jsx')],
  ['admin/Parameters', () => import('./admin/Parameters.jsx')],
  ['admin/Batches', () => import('./admin/Batches.jsx')],
  ['admin/Audit', () => import('./admin/Audit.jsx')],
  ['admin/TrainerComparison', () => import('./admin/TrainerComparison.jsx')],
  ['admin/Cohorts', () => import('./admin/Cohorts.jsx')],
  ['admin/ClassFeedback', () => import('./admin/ClassFeedback.jsx'), { path: '/admin/class/:classId', route: '/admin/class/c1' }],
  ['admin/BatchFeedback', () => import('./admin/BatchFeedback.jsx'), { path: '/admin/batch/:batchId', route: '/admin/batch/b1' }],
  ['trainer/Dashboard', () => import('./trainer/Dashboard.jsx')],
  ['trainer/Batches', () => import('./trainer/Batches.jsx')],
  ['trainer/ClassFeedback', () => import('./trainer/ClassFeedback.jsx'), { path: '/trainer/class/:classId', route: '/trainer/class/c1' }],
  ['trainer/BatchFeedback', () => import('./trainer/BatchFeedback.jsx'), { path: '/trainer/batch/:batchId', route: '/trainer/batch/b1' }],
  ['public/StudentFlow', () => import('./public/StudentFlow.jsx'), { path: '/feedback/:batchId', route: '/feedback/b1' }],
  ['public/ThankYou', () => import('./public/ThankYou.jsx')],
];

describe('every page mounts without throwing', () => {
  beforeEach(() => {
    // A render error is reported through console.error; let it through so the
    // failure message names the component rather than being swallowed.
    vi.spyOn(console, 'error');
  });

  for (const [name, load, opts] of PAGES) {
    it(name, async () => {
      const mod = await load();
      const Component = mod.default;
      expect(Component, `${name} has no default export`).toBeTypeOf('function');
      await mountPage(Component, opts);

      // React logs the thrown error before the boundary/test catches it, so an
      // "is not defined" or "cannot read properties of undefined" here is the
      // blank-screen bug reproduced.
      const fatal = console.error.mock.calls
        .flat()
        .map(String)
        .find((m) => /is not defined|is not a function|Cannot read propert|undefined is not/.test(m));
      expect(fatal, `${name} threw during render: ${fatal}`).toBeUndefined();
    });
  }
});
