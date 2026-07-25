import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import Spinner from '../components/Spinner.jsx';
import ForcePasswordChange from '../pages/ForcePasswordChange.jsx';

/**
 * Role-aware route guard. Redirects unauthenticated users to /login and
 * users with the wrong role to their own home. This is a UX guard only —
 * the API independently enforces every permission server-side.
 */
export default function ProtectedRoute({ role, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-surface">
        <Spinner label="Loading…" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;

  /* Accounts still on an admin-issued password see ONLY this screen. The server
     independently refuses every data route until the flag clears, so this is a
     usability affordance over a real gate, not the gate itself. */
  if (user.mustChangePassword) return <ForcePasswordChange />;
  if (role && user.role !== role) {
    return <Navigate to={user.role === 'admin' ? '/admin' : '/trainer'} replace />;
  }
  return children;
}
