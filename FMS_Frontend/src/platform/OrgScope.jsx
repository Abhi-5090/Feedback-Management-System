import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { PlatformAPI } from '../api/endpoints.js';
import { setOrganizationHeader } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';

/**
 * The organization a super admin is currently looking at.
 *
 * A super admin belongs to no organization, so every request they make has to
 * say which tenant it is about. That choice lives here, is persisted so a
 * refresh does not drop them back to nowhere, and is pushed into the API
 * client — which attaches it to every call — rather than threaded through
 * each page.
 *
 * For an admin or a trainer this provider does nothing at all. Their tenant is
 * a property of their account and is resolved server-side; there is no client
 * state that could widen it, which is the point.
 */
const KEY = 'fms.organization';
const OrgScopeContext = createContext(null);

export function OrgScopeProvider({ children }) {
  const { user } = useAuth();
  /* `mustChangePassword` gates every fetch below. An account still on an
     issued password is refused every data route by design, so fetching from a
     provider that sits ABOVE the router — and therefore renders even while
     ProtectedRoute is showing the change-password screen — produces nothing
     but a guaranteed 403. */
  const locked = Boolean(user?.mustChangePassword);
  const isSuper = user?.role === 'superadmin' && !locked;

  const [organizations, setOrganizations] = useState([]);
  const [orgId, setOrgId] = useState(() => {
    try {
      return localStorage.getItem(KEY) || '';
    } catch {
      return '';
    }
  });
  const [loaded, setLoaded] = useState(false);

  /* Push into the client BEFORE any page fetches. A render that issues a
     request before the header is set would be answered unscoped, which for a
     super admin means the platform-wide view rather than the organization
     they chose — wrong, and quietly so. */
  useEffect(() => {
    setOrganizationHeader(isSuper ? orgId : undefined);
  }, [isSuper, orgId]);

  useEffect(() => {
    if (!isSuper) {
      setOrganizations([]);
      setLoaded(true);
      return undefined;
    }
    let alive = true;
    PlatformAPI.overview()
      .then((d) => {
        if (!alive) return;
        setOrganizations(d.organizations || []);
        setLoaded(true);
      })
      .catch(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [isSuper]);

  /* A stored id for an organization that has since been removed or suspended
     would leave every request pointed at nothing. Fall back to the platform
     view rather than leaving them stuck on an error. */
  useEffect(() => {
    if (!isSuper || !loaded || !orgId) return;
    if (!organizations.some((o) => o.id === orgId)) setOrgId('');
  }, [isSuper, loaded, orgId, organizations]);

  const setOrg = useCallback((next) => {
    const value = next || '';
    setOrgId(value);
    try {
      if (value) localStorage.setItem(KEY, value);
      else localStorage.removeItem(KEY);
    } catch {
      /* Private browsing — the choice simply does not survive a refresh. */
    }
  }, []);

  const value = useMemo(
    () => ({
      isSuper,
      orgId,
      setOrg,
      organizations,
      loaded,
      current: organizations.find((o) => o.id === orgId) || null,
      /* True when a super admin has not picked one: the platform-wide view. */
      isPlatformView: isSuper && !orgId,
    }),
    [isSuper, orgId, setOrg, organizations, loaded]
  );

  return <OrgScopeContext.Provider value={value}>{children}</OrgScopeContext.Provider>;
}

/** Safe outside the provider, so pages rendered in tests need not care. */
export function useOrgScope() {
  return (
    useContext(OrgScopeContext) || {
      isSuper: false, orgId: '', setOrg: () => {}, organizations: [],
      loaded: true, current: null, isPlatformView: false,
    }
  );
}
