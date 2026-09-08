import { api } from './client.js';

// A thin, typed-ish wrapper over every backend endpoint the UI uses.
export const AuthAPI = {
  login: (email, password) => api.post('/auth/login', { email, password }).then((r) => r.data),
  me: () => api.get('/auth/me').then((r) => r.data),
  updateMe: (body) => api.patch('/auth/me', body).then((r) => r.data),
  // Digest opt-in/out. Both roles; the scheduler has no recipients until
  // someone turns this on.
  updateDigest: (body) => api.patch('/auth/me/digest', body).then((r) => r.data),
  // Deployment facts for Settings: mail transport, transaction support, limits.
  system: () => api.get('/auth/system').then((r) => r.data),
  forgotPassword: (email) => api.post('/auth/forgot-password', { email }).then((r) => r.data),
  resetPassword: (token, newPassword) =>
    api.post('/auth/reset-password', { token, newPassword }).then((r) => r.data),
  logout: () => api.post('/auth/logout').then((r) => r.data),
  logoutEverywhere: () => api.post('/auth/logout-all').then((r) => r.data),
};

export const TrainersAPI = {
  // Paginated. Returns { trainers, page, limit, total, pages } — the mentor
  // roster grows monotonically, so the browser never receives all of it.
  list: (params = {}) => api.get('/trainers', { params }).then((r) => r.data),
  create: (body) => api.post('/trainers', body).then((r) => r.data.trainer),
  update: (id, body) => api.patch(`/trainers/${id}`, body).then((r) => r.data.trainer),
  setActive: (id, isActive) =>
    api.patch(`/trainers/${id}`, { isActive }).then((r) => r.data.trainer),
  /* Mint a single-use reset link and return it. The way back into an account
     when email is not configured or is not reaching the person. */
  resetLink: (id) => api.post(`/trainers/${id}/reset-link`).then((r) => r.data),
  // ── Bulk Excel import ──────────────────────────────────────────────────
  // Step 1: parse + validate the workbook server-side. Writes nothing.
  bulkPreview: (fileBase64, filename) =>
    api.post('/trainers/bulk/preview', { fileBase64, filename }).then((r) => r.data),
  // Step 2: create the reviewed rows with one shared default password.
  // Partial success is normal — callers must read the per-row outcome.
  bulk: (trainers, defaultPassword) =>
    api.post('/trainers/bulk', { trainers, defaultPassword }).then((r) => r.data),
};

export const ClassesAPI = {
  list: (params = {}) => api.get('/classes', { params }).then((r) => r.data),
  create: (body) => api.post('/classes', body).then((r) => r.data.class),
  update: (id, body) => api.patch(`/classes/${id}`, body).then((r) => r.data.class),
  archive: (id, archived) => api.patch(`/classes/${id}/archive`, { archived }).then((r) => r.data),
};

export const ParametersAPI = {
  list: (activeOnly = false) =>
    api
      .get('/parameters', { params: activeOnly ? { activeOnly: 1 } : {} })
      .then((r) => r.data.parameters),
  create: (body) => api.post('/parameters', body).then((r) => r.data.parameter),
  update: (id, body) => api.patch(`/parameters/${id}`, body).then((r) => r.data.parameter),
  remove: (id) => api.delete(`/parameters/${id}`).then((r) => r.data),
};

export const BatchesAPI = {
  // Paginated + filterable: { batches, page, limit, total, pages, filters }.
  list: (params = {}) => api.get('/batches', { params }).then((r) => r.data),
  create: (body) => api.post('/batches', body).then((r) => r.data.batch),
  update: (id, body) => api.patch(`/batches/${id}`, body).then((r) => r.data.batch),
  unlock: (id, expectedCount) =>
    api.post(`/batches/${id}/unlock`, { expectedCount }).then((r) => r.data),
  lock: (id) => api.post(`/batches/${id}/lock`).then((r) => r.data.batch),
  rotatePasscode: (id) => api.post(`/batches/${id}/passcode`).then((r) => r.data),
  // Per-round device/response counts, so re-running a cohort is visible.
  rounds: (id) => api.get(`/batches/${id}/rounds`).then((r) => r.data),
  archive: (id, archived) => api.patch(`/batches/${id}/archive`, { archived }).then((r) => r.data),
};

export const AuditAPI = {
  list: (params = {}) => api.get('/audit', { params }).then((r) => r.data),
  actionLabels: () => api.get('/audit/actions').then((r) => r.data.labels),
};

export const SystemAPI = {
  /* Send a real message and report whether it was DELIVERED or merely printed
     to the server log — the two look identical from the outside otherwise. */
  testMail: (to) => api.post('/system/mail/test', to ? { to } : {}).then((r) => r.data),
  // Fires any due digests immediately. Without this, "did the digest work?"
  // can only be answered by waiting an hour and reading server logs.
  runDigests: (force = false) =>
    api.post('/system/digests/run', { force }).then((r) => r.data),
};

export const AnalyticsAPI = {
  // Class cards for the Feedbacks tab. Role-scoped server-side: admin gets
  // every class, a mentor gets only the ones they staff — same call either way.
  // `role` narrows a mentor to 'main' (delivered) or 'support' (assisted).
  classes: (params = {}) => api.get('/analytics/classes', { params }).then((r) => r.data.classes),
  trainers: (params = {}) => api.get('/analytics/trainers', { params }).then((r) => r.data),
  /* One card per SESSION (a batch+subject pair) — the grain feedback is
     actually read at. `yearGroup`, `classId` and `role` narrow it server-side,
     and the returned filter lists describe only what the caller can see. */
  sessions: (params = {}) => api.get('/analytics/sessions', { params }).then((r) => r.data),
  // The year-group cards that open the catalog.
  years: () => api.get('/analytics/years').then((r) => r.data.years),
  // Year-group roll-up and the mentor deployment matrix (admin).
  cohorts: () => api.get('/analytics/cohorts').then((r) => r.data.cohorts),
  mentorLoad: () => api.get('/analytics/mentor-load').then((r) => r.data.mentors),
  themes: (params = {}) => api.get('/analytics/themes', { params }).then((r) => r.data),
  comments: (params = {}) => api.get('/analytics/comments', { params }).then((r) => r.data),
  deltas: (params = {}) => api.get('/analytics/deltas', { params }).then((r) => r.data),
  class: (id, params = {}) => api.get(`/analytics/class/${id}`, { params }).then((r) => r.data),
  batch: (id, params = {}) => api.get(`/analytics/batch/${id}`, { params }).then((r) => r.data),
  trainerMe: (params = {}) => api.get('/analytics/trainer/me', { params }).then((r) => r.data),
  trainerBatches: (params = {}) =>
    api.get('/analytics/trainer/batches', { params }).then((r) => r.data.batches),
  // My figures as main mentor vs as support mentor.
  roleSplit: (params = {}) => api.get('/analytics/role-split', { params }).then((r) => r.data),
};

export const DashboardAPI = {
  admin: (params = {}) => api.get('/dashboard/admin', { params }).then((r) => r.data),
  trainerMe: (params = {}) => api.get('/dashboard/trainer/me', { params }).then((r) => r.data),
};

export const PublicAPI = {
  verifyPasscode: (batchId, passcode) =>
    api.post('/public/verify-passcode', { batchId, passcode }).then((r) => r.data),
  submitFeedback: (body) => api.post('/public/feedback', body).then((r) => r.data),
};

/**
 * Trigger a file download for an export endpoint. Uses a blob so the httpOnly
 * cookie / Bearer header still authenticate (unlike a raw anchor href).
 */
export async function downloadExport(path, params, filename) {
  const res = await api.get(path, { params, responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
