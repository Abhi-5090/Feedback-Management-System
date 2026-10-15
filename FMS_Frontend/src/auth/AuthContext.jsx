import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { AuthAPI } from '../api/endpoints.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  /* Carried beside the user because the client needs the tenant's TIMEZONE
     before it renders a single date — see useTenantTime. */
  const [organization, setOrganization] = useState(null);
  /* Where this person works, and what they may do in the organization they
     are currently in — both come from the server, which is the only thing
     that decides either. */
  const [memberships, setMemberships] = useState([]);
  const [membershipRole, setMembershipRole] = useState(null);
  const [loading, setLoading] = useState(true);

  // On mount, ask the API who we are. The httpOnly auth cookie (if present) is
  // sent automatically; a 401 simply means "not logged in".
  useEffect(() => {
    (async () => {
      try {
        const { user, organization, memberships, role } = await AuthAPI.me();
        setUser(user ? { ...user, memberships: memberships || [] } : null);
        setOrganization(organization || null);
        setMemberships(memberships || []);
        setMembershipRole(role || null);
      } catch {
        setUser(null);
    setOrganization(null);
    setMemberships([]);
    setMembershipRole(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (email, password) => {
    // The server sets the httpOnly cookie; we only keep the user in memory.
    const data = await AuthAPI.login(email, password);
    setUser(data.user ? { ...data.user, memberships: data.memberships || [] } : null);
    setOrganization(data.organization || null);
    setMemberships(data.memberships || []);
    setMembershipRole(data.role || null);
    return data.user;
  }, []);

  /** Re-read the current user (after a self-service profile update). */
  const refresh = useCallback(async () => {
    try {
      const { user, organization, memberships, role } = await AuthAPI.me();
      setUser(user ? { ...user, memberships: memberships || [] } : null);
      setOrganization(organization || null);
      setMemberships(memberships || []);
      setMembershipRole(role || null);
    } catch {
      /* a failed refresh shouldn't sign anyone out */
    }
  }, []);

  const logout = useCallback(async () => {
    try { await AuthAPI.logout(); } catch { /* ignore */ }
    setUser(null);
    setOrganization(null);
    setMemberships([]);
    setMembershipRole(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, organization, memberships, membershipRole, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
