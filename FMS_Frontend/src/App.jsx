import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './auth/ProtectedRoute.jsx';
import Spinner from './components/Spinner.jsx';

// Eager: the two entry points a cold visitor hits first (login + the anonymous
// student link). Loading these inline avoids a spinner flash on first paint.
import Login from './pages/Login.jsx';
import StudentFlow from './pages/public/StudentFlow.jsx';
import NotFound from './pages/NotFound.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';

// Lazy: everything behind auth. These pull in the heavy chart/animation code
// (Recharts, framer-motion), so they load as separate chunks only when an
// admin or trainer actually navigates to them.
const Feedbacks = lazy(() => import('./pages/Feedbacks.jsx'));
const Guide = lazy(() => import('./pages/Guide.jsx'));
const Comments = lazy(() => import('./pages/Comments.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Audit = lazy(() => import('./pages/admin/Audit.jsx'));
const TrainerComparison = lazy(() => import('./pages/admin/TrainerComparison.jsx'));
const Cohorts = lazy(() => import('./pages/admin/Cohorts.jsx'));
const AdminLayout = lazy(() => import('./layouts/AdminLayout.jsx'));
const AdminDashboard = lazy(() => import('./pages/admin/Dashboard.jsx'));
const Trainers = lazy(() => import('./pages/admin/Trainers.jsx'));
const Classes = lazy(() => import('./pages/admin/Classes.jsx'));
const Parameters = lazy(() => import('./pages/admin/Parameters.jsx'));
const Batches = lazy(() => import('./pages/admin/Batches.jsx'));
const AdminClassFeedback = lazy(() => import('./pages/admin/ClassFeedback.jsx'));
const AdminBatchFeedback = lazy(() => import('./pages/admin/BatchFeedback.jsx'));

const TrainerLayout = lazy(() => import('./layouts/TrainerLayout.jsx'));
const TrainerDashboard = lazy(() => import('./pages/trainer/Dashboard.jsx'));
const TrainerClassFeedback = lazy(() => import('./pages/trainer/ClassFeedback.jsx'));
const TrainerBatchFeedback = lazy(() => import('./pages/trainer/BatchFeedback.jsx'));
const TrainerBatches = lazy(() => import('./pages/trainer/Batches.jsx'));

/** Full-viewport fallback shown while a lazy route chunk downloads. */
function RouteFallback() {
  return (
    <div className="grid min-h-screen place-items-center bg-surface">
      <Spinner label="Loading…" />
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        {/* Anonymous student feedback — entered via a per-batch link */}
        <Route path="/feedback/:batchId" element={<StudentFlow />} />

        {/* Admin */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute role="admin">
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<AdminDashboard />} />
          <Route path="feedbacks" element={<Feedbacks />} />
          <Route path="trainers" element={<Trainers />} />
          <Route path="classes" element={<Classes />} />
          <Route path="parameters" element={<Parameters />} />
          <Route path="batches" element={<Batches />} />
          <Route path="class/:classId" element={<AdminClassFeedback />} />
          <Route path="batch/:batchId" element={<AdminBatchFeedback />} />
          <Route path="guide" element={<Guide />} />
          <Route path="comments" element={<Comments />} />
          <Route path="settings" element={<Settings />} />
          <Route path="audit" element={<Audit />} />
          <Route path="compare" element={<TrainerComparison />} />
          <Route path="cohorts" element={<Cohorts />} />
        </Route>

        {/* Trainer */}
        <Route
          path="/trainer"
          element={
            <ProtectedRoute role="trainer">
              <TrainerLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<TrainerDashboard />} />
          <Route path="feedbacks" element={<Feedbacks />} />
          <Route path="batches" element={<TrainerBatches />} />
          <Route path="class/:classId" element={<TrainerClassFeedback />} />
          <Route path="batch/:batchId" element={<TrainerBatchFeedback />} />
          <Route path="guide" element={<Guide />} />
          <Route path="comments" element={<Comments />} />
          <Route path="settings" element={<Settings />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
