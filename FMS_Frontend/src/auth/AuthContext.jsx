import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { AuthAPI } from '../api/endpoints.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // On mount, ask the API who we are. The httpOnly auth cookie (if present) is
  // sent automatically; a 401 simply means "not logged in".
  useEffect(() => {
    (async () => {
      try {
        const { user } = await AuthAPI.me();
        setUser(user);
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (email, password) => {
    // The server sets the httpOnly cookie; we only keep the user in memory.
    const data = await AuthAPI.login(email, password);
    setUser(data.user);
    return data.user;
  }, []);

  /** Re-read the current user (after a self-service profile update). */
  const refresh = useCallback(async () => {
    try {
      const { user } = await AuthAPI.me();
      setUser(user);
    } catch {
      /* a failed refresh shouldn't sign anyone out */
    }
  }, []);

  const logout = useCallback(async () => {
    try { await AuthAPI.logout(); } catch { /* ignore */ }
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
