import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import Spinner from '../components/Spinner.jsx';
import ForcePasswordChange from '../pages/ForcePasswordChange.jsx';

/**
 * Role-aware route guard. Redirects unauthenticated users to /login and
 * users with the wrong role to their own home. This is a UX guard only —
 * the API independently enforces every permission server-side.
 */
/** Where each role belongs when it lands somewhere it should not be. */
const home = (role) =>
  role === 'superadmin' ? '/platform' : role === 'admin' ? '/admin' : '/trainer';

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
  /* A super admin administering a chosen organization uses the ADMIN screens —
     there is no second copy of the dashboard for them, which is what keeps the
     two from drifting apart. They are therefore allowed through an `admin`
     guard, and the server still decides what they can see from the
     organization header. */
  const allowed = role === 'admin' ? ['admin', 'superadmin'] : [role];
  if (role && !allowed.includes(user.role)) {
    return <Navigate to={home(user.role)} replace />;
  }
  return children;
}
