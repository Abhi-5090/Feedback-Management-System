import { useCallback, useEffect, useRef, useState } from 'react';
import { TrainersAPI } from '../api/endpoints.js';
import { useToast } from './Toast.jsx';
import Modal from './Modal.jsx';
import Icon from './Icon.jsx';

const initials = (name) =>
  (name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

/**
 * Find somebody who already teaches elsewhere and add them here.
 *
 * The same mentor often teaches at several of these colleges, so the common
 * case is not "create a person" but "find the person who already exists".
 * Creating a second account for them instead would split one teacher's
 * history across two logins and two passwords, and neither would be right.
 *
 * It searches rather than lists. A browsable roll of everybody on the
 * platform is a bigger thing to put on screen than a lookup, and the task is
 * always somebody you already know the name of.
 *
 * What it shows is identity. Not ratings, not cohorts, not where else they
 * teach — staffing somebody does not require reading their performance
 * review at another college.
 */
export default function AddExistingMentor({ open, onClose, onAdded }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [people, setPeople] = useState(null);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState(null);
  const inputRef = useRef(null);
  const seq = useRef(0);

  const search = useCallback(async (term) => {
    const mine = ++seq.current;
    if (term.trim().length < 2) {
      setPeople(null);
      return;
    }
    setSearching(true);
    try {
      const res = await TrainersAPI.directory(term.trim());
      /* Only the newest search may paint. Typing quickly fires several, and
         without this an earlier, slower reply can land last and overwrite the
         results for what was actually typed. */
      if (mine === seq.current) setPeople(res.people || []);
    } catch (e) {
      if (mine === seq.current) toast.error(e.message);
    } finally {
      if (mine === seq.current) setSearching(false);
    }
  }, [toast]);

  // Debounced: a request per keystroke would be mostly wasted work.
  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => search(q), 220);
    return () => clearTimeout(t);
  }, [q, open, search]);

  useEffect(() => {
    if (!open) { setQ(''); setPeople(null); return undefined; }
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  const add = async (person) => {
    setAddingId(person.id);
    try {
      await TrainersAPI.addExisting(person.id);
      toast.success(`${person.name} added — they sign in with their existing password.`);
      onAdded?.();
      onClose();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setAddingId(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add an existing mentor"
      description="Somebody who already teaches at another institution on this platform."
    >
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="directory-search">Search by name or email</label>
          <div className="relative">
            <Icon
              name="search"
              size={15}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle"
            />
            <input
              id="directory-search"
              ref={inputRef}
              className="input !pl-10"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="meera, or meera@…"
              autoComplete="off"
            />
          </div>
          <p className="hint">
            They keep one account and one password. This institution simply appears alongside their
            others when they sign in.
          </p>
        </div>

        <div className="min-h-[7rem]">
          {q.trim().length < 2 && (
            <p className="px-1 py-6 text-center text-xs text-muted">
              Type at least two characters.
            </p>
          )}

          {q.trim().length >= 2 && searching && !people && (
            <p className="px-1 py-6 text-center text-xs text-muted">Searching…</p>
          )}

          {people?.length === 0 && (
            <p className="px-1 py-6 text-center text-xs leading-relaxed text-muted">
              Nobody on the platform matches “{q.trim()}”.
              <br />
              If they are new, close this and use <strong className="text-ink">New mentor</strong> instead.
            </p>
          )}

          {people?.length > 0 && (
            <ul className="stagger divide-y divide-line overflow-hidden rounded-xl border border-line">
              {people.map((p) => (
                <li key={p.id} className="flex items-center gap-3 bg-card px-3.5 py-3">
                  <span
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-500/12 text-[11px] font-bold text-brand-700 ring-1 ring-inset ring-brand-500/20 dark:text-brand-300"
                    aria-hidden="true"
                  >
                    {initials(p.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{p.name}</span>
                    <span className="block truncate text-[11px] text-muted">{p.email}</span>
                  </span>
                  {p.alreadyHere ? (
                    <span className="shrink-0 text-[11px] font-semibold text-muted">Already here</span>
                  ) : (
                    <button
                      type="button"
                      className="btn-outline shrink-0 !py-1.5 text-xs"
                      disabled={addingId === p.id}
                      onClick={() => add(p)}
                    >
                      {addingId === p.id ? 'Adding…' : 'Add'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end">
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}
