import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { PhasesAPI } from '../api/endpoints.js';
import { setPhaseParam } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';

/**
 * The phase currently being looked at, shared by every screen that shows
 * feedback.
 *
 * WHY A CONTEXT AND NOT A PROP ON EACH PAGE. The selection has to survive
 * navigation. An admin who narrows to Phase 2 on the dashboard and then opens
 * Feedbacks is still thinking about Phase 2; resetting to "All phases" on
 * every route change makes the filter something you re-apply rather than
 * something you are inside, and the numbers on two screens would silently
 * describe different things.
 *
 * It persists to localStorage for the same reason — coming back tomorrow
 * mid-exercise should not start from scratch.
 *
 * ALL PHASES IS THE DEFAULT, and is a real value rather than the absence of
 * one. A dashboard that opens pre-filtered to one phase is a dashboard that
 * lies by omission to anyone who does not notice the filter.
 */

const KEY = 'fms_phase_scope';
export const ALL = 'all';
export const UNASSIGNED = 'unassigned';

const PhaseScopeContext = createContext(null);

function readStored() {
  try {
    return localStorage.getItem(KEY) || ALL;
  } catch {
    // Private mode, blocked storage — the default is always safe.
    return ALL;
  }
}

export function PhaseScopeProvider({ children }) {
  const { user } = useAuth();
  const [phase, setPhaseState] = useState(readStored);
  const [phases, setPhases] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Only once signed in — the phase list is an authenticated call, and the
    // student flow never signs in at all.
    if (!user) {
      setPhases([]);
      setLoaded(false);
      return undefined;
    }
    let alive = true;
    PhasesAPI.list()
      .then((res) => {
        if (!alive) return;
        setPhases(res.phases || []);
        setLoaded(true);
      })
      .catch(() => {
        // A failed load must not break every page that reads this. The filter
        // simply offers nothing but "All phases".
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [user]);

  /* If the stored phase no longer exists — deleted, or a different deployment —
     fall back to ALL rather than filtering on an id that matches nothing and
     showing an empty dashboard that looks like data loss. */
  useEffect(() => {
    if (!loaded || phase === ALL || phase === UNASSIGNED) return;
    if (!phases.some((p) => p._id === phase)) setPhaseState(ALL);
  }, [loaded, phase, phases]);

  /* Push the value into the API client BEFORE any render that depends on it,
     so the first fetch after a change already carries the new phase. A layout
     effect would be later than the state update the pages react to. */
  const setPhase = useCallback((next) => {
    setPhaseState(next || ALL);
    setPhaseParam(next === ALL ? undefined : next);
    try {
      localStorage.setItem(KEY, next || ALL);
    } catch {
      /* not persisting is survivable; not setting it is not */
    }
  }, []);

  // Keep the client in step with the stored value on first mount too.
  useEffect(() => {
    setPhaseParam(phase === ALL ? undefined : phase);
  }, [phase]);

  const value = useMemo(() => {
    const active = phases.find((p) => p._id === phase) || null;
    return {
      phase,
      setPhase,
      phases,
      loaded,
      active,
      isAll: phase === ALL,
      /* What every API call appends. `undefined` for ALL so the parameter is
         omitted entirely rather than sent as the string "all", which the
         server would reject as an invalid id. */
      param: phase === ALL ? undefined : phase,
      label: phase === ALL ? 'All phases' : phase === UNASSIGNED ? 'Unassigned' : active?.name || 'All phases',
    };
  }, [phase, setPhase, phases, loaded]);

  return <PhaseScopeContext.Provider value={value}>{children}</PhaseScopeContext.Provider>;
}

/**
 * Read the current phase scope.
 *
 * Safe outside the provider — returns the "all phases" shape — so a component
 * rendered in a test or on the student flow does not have to care.
 */
export function usePhaseScope() {
  return (
    useContext(PhaseScopeContext) || {
      phase: ALL, setPhase: () => {}, phases: [], loaded: true,
      active: null, isAll: true, param: undefined, label: 'All phases',
    }
  );
}
