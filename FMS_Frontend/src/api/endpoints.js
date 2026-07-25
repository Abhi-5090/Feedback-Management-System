import { api } from './client.js';

// A thin, typed-ish wrapper over every backend endpoint the UI uses.
export const AuthAPI = {
  login: (email, password) => api.post('/auth/login', { email, password }).then((r) => r.data),
  me: () => api.get('/auth/me').then((r) => r.data),
  updateMe: (body) => api.patch('/auth/me', body).then((r) => r.data),
  forgotPassword: (email) => api.post('/auth/forgot-password', { email }).then((r) => r.data),
  resetPassword: (token, newPassword) =>
    api.post('/auth/reset-password', { token, newPassword }).then((r) => r.data),
  logout: () => api.post('/auth/logout').then((r) => r.data),
};

export const TrainersAPI = {
  list: () => api.get('/trainers').then((r) => r.data.trainers),
  create: (body) => api.post('/trainers', body).then((r) => r.data.trainer),
  update: (id, body) => api.patch(`/trainers/${id}`, body).then((r) => r.data.trainer),
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
  list: () => api.get('/classes').then((r) => r.data.classes),
  create: (body) => api.post('/classes', body).then((r) => r.data.class),
  update: (id, body) => api.patch(`/classes/${id}`, body).then((r) => r.data.class),
};

export const ParametersAPI = {
  list: (activeOnly = false) =>
    api.get('/parameters', { params: activeOnly ? { activeOnly: 1 } : {} }).then((r) => r.data.parameters),
  create: (body) => api.post('/parameters', body).then((r) => r.data.parameter),
  update: (id, body) => api.patch(`/parameters/${id}`, body).then((r) => r.data.parameter),
  remove: (id) => api.delete(`/parameters/${id}`).then((r) => r.data),
};

export const BatchesAPI = {
  list: (params = {}) => api.get('/batches', { params }).then((r) => r.data.batches),
  create: (body) => api.post('/batches', body).then((r) => r.data.batch),
  update: (id, body) => api.patch(`/batches/${id}`, body).then((r) => r.data.batch),
  unlock: (id, expectedCount) => api.post(`/batches/${id}/unlock`, { expectedCount }).then((r) => r.data),
  lock: (id) => api.post(`/batches/${id}/lock`).then((r) => r.data.batch),
  rotatePasscode: (id) => api.post(`/batches/${id}/passcode`).then((r) => r.data),
  archive: (id, archived) => api.patch(`/batches/${id}/archive`, { archived }).then((r) => r.data),
};

export const AuditAPI = {
  list: (params = {}) => api.get('/audit', { params }).then((r) => r.data),
};

export const ClassesArchiveAPI = {
  archive: (id, archived) => api.patch(`/classes/${id}/archive`, { archived }).then((r) => r.data),
};

export const AnalyticsAPI = {
  // Class cards for the Feedbacks tab. Role-scoped server-side: admin gets
  // every class, a trainer gets only their own — same call either way.
  classes: () => api.get('/analytics/classes').then((r) => r.data.classes),
  trainers: () => api.get('/analytics/trainers').then((r) => r.data),
  themes: (params = {}) => api.get('/analytics/themes', { params }).then((r) => r.data),
  comments: (params = {}) => api.get('/analytics/comments', { params }).then((r) => r.data),
  deltas: (params = {}) => api.get('/analytics/deltas', { params }).then((r) => r.data),
  class: (id) => api.get(`/analytics/class/${id}`).then((r) => r.data),
  batch: (id) => api.get(`/analytics/batch/${id}`).then((r) => r.data),
  trainerMe: () => api.get('/analytics/trainer/me').then((r) => r.data),
  trainerBatches: () => api.get('/analytics/trainer/batches').then((r) => r.data.batches),
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
