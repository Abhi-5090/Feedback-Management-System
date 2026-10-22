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

  /* MEMBERS CARRY THE HEADER TOO, now that one person can work at several
     institutions. It is not a privilege — the server checks it against their
     memberships and refuses any organization they are not in — it is simply
     how a request says which of your own places you are in right now. */
  const memberships = locked ? [] : user?.memberships || [];
  const needsChoice = !isSuper && memberships.length > 1;

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
    /* ANY CHOSEN ORGANIZATION IS SENT, with no cleverness about whether the
       person "needs" to choose.
       
       This used to be gated on having more than one membership, and the gate
       was wrong in the one moment that mattered: the condition is computed
       from state that arrives asynchronously, so immediately after signing in
       it read false and this effect CLEARED the header that had just been set
       by choosing. Every request then went out saying nothing, the server
       asked for a choice, and the person was returned to the picker they had
       just used.
       
       Sending it unconditionally is also simply correct. The server checks
       the header against the caller's memberships and refuses any
       organization they are not in, so naming the only one you have is
       harmless and naming one of several is required. */
    setOrganizationHeader(orgId || undefined);
  }, [orgId]);

  useEffect(() => {
    if (!isSuper && !needsChoice) {
      setOrganizations([]);
      setLoaded(true);
      return undefined;
    }
    if (!isSuper) {
      /* A member's list is their memberships, which arrived with the account —
         no second request, and nothing they are not in. */
      setOrganizations(memberships);
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
    if (!loaded || !orgId) return;

    /* AN EMPTY LIST IS NOT EVIDENCE OF ANYTHING.
       
       A stored organization the person has been removed from would point
       every request at somewhere they cannot go, so it is cleared — but only
       against a list that actually has contents. The list is populated by
       another effect, and React runs effects in order, so immediately after
       choosing an organization this one ran first, saw nothing, concluded the
       choice was stale and threw it away. The next request went out naming no
       institution, the server asked for a choice, and the person was returned
       to the picker they had just used. Clicking again raced identically: a
       loop with nothing on screen to explain it.
       
       "I do not know yet" and "you are not a member" are different answers,
       and only the second justifies discarding somebody's choice. */
    if (organizations.length === 0) return;
    if (!organizations.some((o) => o.id === orgId)) setOrgId('');
  }, [loaded, orgId, organizations]);

  const setOrg = useCallback((next) => {
    const value = next || '';

    /* APPLIED SYNCHRONOUSLY, not left to the effect below.
       
       Choosing an organization is immediately followed by navigating into it,
       and React runs effects children-first — so the page being navigated to
       fetched BEFORE the provider above it had set the header. The request
       went out saying nothing about which institution, came back asking for a
       choice, and bounced the person straight back to the picker they had
       just used. Clicking again raced again: a loop with no error on screen.
       
       The effect stays, for the orgId restored from storage on a cold load.
       This line is for the instant the choice is made. */
    setOrganizationHeader(value || undefined);
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
      needsChoice,
      current: organizations.find((o) => o.id === orgId) || null,
      /* True when a super admin has not picked one: the platform-wide view. */
      isPlatformView: isSuper && !orgId,
      /* A member who must choose and has not yet. */
      awaitingChoice: needsChoice && !orgId,
    }),
    [isSuper, needsChoice, orgId, setOrg, organizations, loaded]
  );

  return <OrgScopeContext.Provider value={value}>{children}</OrgScopeContext.Provider>;
}

/** Safe outside the provider, so pages rendered in tests need not care. */
export function useOrgScope() {
  return (
    useContext(OrgScopeContext) || {
      isSuper: false, orgId: '', setOrg: () => {}, organizations: [],
      loaded: true, current: null, isPlatformView: false,
      needsChoice: false, awaitingChoice: false,
    }
  );
}
