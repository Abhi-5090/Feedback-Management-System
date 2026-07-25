import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PublicAPI } from '../../api/endpoints.js';
import { lightweightFingerprint } from '../../lib/fingerprint.js';
import StarRating from '../../components/StarRating.jsx';
import Icon from '../../components/Icon.jsx';

const MIN_COMMENT = 10;

/**
 * Step 2 — rate EVERY class in the batch, each on all active parameters, each
 * with its own mandatory comment. A batch now holds several classes, so this
 * form has one section per class and submits them together as a single
 * anonymous response (one Feedback row per class on the server).
 *
 * Three decisions worth naming:
 *
 * 1. The progress bar animates with scaleX on a transform, not `width`.
 *    Animating width relayouts the bar every frame; a transform runs on the
 *    compositor — same visual, a fraction of the cost on the mid-range phones
 *    where this form is actually filled in.
 *
 * 2. The submit button never silently disables into a dead end. When something
 *    is missing it stays visible and SAYS what's missing (and which class), so
 *    the user is never tapping a grey rectangle wondering why.
 *
 * 3. State is keyed by classId, so adding/removing a class server-side can
 *    never cross-wire one class's ratings onto another.
 */
export default function FeedbackForm({ batchId, session, onSubmitted }) {
  const params = session?.parameters || [];
  const classes = session?.classes || [];

  // classId -> { ratings: { paramId: stars }, comment }
  const [data, setData] = useState(() =>
    Object.fromEntries(classes.map((c) => [c.id, { ratings: {}, comment: '' }]))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const setStar = (classId, paramId, stars) =>
    setData((d) => ({ ...d, [classId]: { ...d[classId], ratings: { ...d[classId].ratings, [paramId]: stars } } }));
  const setComment = (classId, comment) =>
    setData((d) => ({ ...d, [classId]: { ...d[classId], comment } }));

  // Per-class + overall completion.
  const perClass = useMemo(
    () =>
      classes.map((c) => {
        const st = data[c.id] || { ratings: {}, comment: '' };
        const rated = Object.keys(st.ratings).length;
        const commentLen = st.comment.trim().length;
        const done = rated === params.length && params.length > 0 && commentLen >= MIN_COMMENT;
        return { c, rated, commentLen, commentOk: commentLen >= MIN_COMMENT, allRated: rated === params.length, done };
      }),
    [classes, data, params.length]
  );

  const totalNeeded = classes.length * params.length;
  const totalRated = perClass.reduce((n, p) => n + p.rated, 0);
  const progress = totalNeeded ? Math.round((totalRated / totalNeeded) * 100) : 0;
  const classesDone = perClass.filter((p) => p.done).length;
  const canSubmit = perClass.length > 0 && perClass.every((p) => p.done);

  // Name the first incomplete class and what it still needs.
  const missingLabel = useMemo(() => {
    const next = perClass.find((p) => !p.done);
    if (!next) return 'Submit feedback';
    if (!next.allRated) {
      const left = params.length - next.rated;
      return `${next.c.name}: rate ${left} more ${left === 1 ? 'item' : 'items'}`;
    }
    return `${next.c.name}: add ${MIN_COMMENT - next.commentLen} more characters`;
  }, [perClass, params.length]);

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await PublicAPI.submitFeedback({
        batchId,
        classes: classes.map((c) => ({
          classId: c.id,
          ratings: params.map((p) => ({ parameter: p._id, stars: data[c.id].ratings[p._id] })),
          comment: data[c.id].comment.trim(),
        })),
        fingerprint: lightweightFingerprint(),
        sessionToken: session?.sessionToken,
      });
      onSubmitted({ ...res, ok: true });
    } catch (err) {
      // Duplicate / cap → route to the thank-you screen with the reason.
      if (err.code === 'DEVICE_LOCKED') return onSubmitted({ alreadyRecorded: true });
      if (err.code === 'CAP_REACHED') return onSubmitted({ capReached: true });
      setError(err.message || 'Could not submit. Please try again.');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3.5" noValidate>
      {/* ── Sticky progress ───────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 -mx-1 px-1 pb-1 pt-1">
        <div className="card border-line/80 p-3.5 shadow-card backdrop-blur supports-[backdrop-filter]:bg-card/85">
          <div className="mb-2 flex items-center justify-between text-xs font-semibold">
            <span className="text-muted">
              {classes.length > 1 ? (
                <>
                  <span className="tnum text-ink">{classesDone}</span> of{' '}
                  <span className="tnum text-ink">{classes.length}</span> classes complete
                </>
              ) : (
                <>
                  Rated <span className="tnum text-ink">{totalRated}</span> of{' '}
                  <span className="tnum text-ink">{totalNeeded}</span>
                </>
              )}
            </span>
            <span
              className={`tnum transition-colors duration-200 ${
                canSubmit ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted'
              }`}
            >
              {progress}%
            </span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-line"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Feedback progress"
          >
            <motion.div
              className="h-full origin-left rounded-full bg-gradient-to-r from-brand-500 to-brand-600"
              initial={false}
              animate={{ transform: `scaleX(${progress / 100})` }}
              transition={{ type: 'spring', duration: 0.5, bounce: 0.18 }}
              style={{ width: '100%' }}
            />
          </div>
        </div>
      </div>

      {/* ── One section per class ─────────────────────────────────────────── */}
      {classes.map((c, ci) => {
        const status = perClass[ci];
        return (
          <section
            key={c.id}
            className="card animate-fade-up overflow-hidden p-0"
            style={{ animationDelay: `${Math.min(ci * 60, 300)}ms` }}
          >
            {/* Class header */}
            <header className="flex items-center gap-3 border-b border-line bg-surface-2/40 px-4 py-3">
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl text-sm font-bold transition-colors duration-200 ${
                  status.done
                    ? 'bg-emerald-500 text-white'
                    : 'bg-brand-500/10 text-brand-600 dark:text-brand-400'
                }`}
              >
                {status.done ? <Icon name="check" size={16} /> : ci + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-ink">{c.name}</p>
                {c.trainerName && <p className="truncate text-[11px] text-muted">{c.trainerName}</p>}
              </div>
              <span
                className={`tnum shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  status.done
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'bg-surface-2 text-muted'
                }`}
              >
                {status.rated}/{params.length}
              </span>
            </header>

            <div className="space-y-2.5 p-4">
              {c.description && <p className="text-xs leading-relaxed text-muted">{c.description}</p>}

              {/* Parameter rows */}
              <ul className="space-y-2.5">
                {params.map((p) => {
                  const rated = Boolean(data[c.id]?.ratings[p._id]);
                  return (
                    <li key={p._id} className="rounded-xl border border-line bg-surface-2/30 p-3">
                      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                            <span
                              aria-hidden="true"
                              className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-200 ${
                                rated ? 'bg-emerald-500' : 'bg-line'
                              }`}
                            />
                            {p.label}
                          </p>
                          {p.description && (
                            <p className="mt-0.5 pl-3 text-[11px] leading-relaxed text-muted">{p.description}</p>
                          )}
                        </div>
                        <div className="shrink-0 pl-3 sm:pl-0">
                          <StarRating
                            name={`${c.id}-${p.label}`}
                            value={data[c.id]?.ratings[p._id] || 0}
                            onChange={(v) => setStar(c.id, p._id, v)}
                            size={30}
                          />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {/* Per-class comment */}
              <div className="rounded-xl border border-line bg-surface-2/30 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label htmlFor={`comment-${c.id}`} className="text-sm font-semibold text-ink">
                    Comment on {c.name} <span className="text-rose-500">*</span>
                  </label>
                  <span
                    className={`tnum text-xs font-semibold transition-colors duration-200 ${
                      status.commentOk ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted'
                    }`}
                  >
                    {status.commentOk ? `${status.commentLen} characters` : `${status.commentLen}/${MIN_COMMENT}`}
                  </span>
                </div>
                <textarea
                  id={`comment-${c.id}`}
                  rows={3}
                  value={data[c.id]?.comment || ''}
                  onChange={(e) => setComment(c.id, e.target.value)}
                  placeholder="What went well? What could be better?"
                  className="input resize-none leading-relaxed"
                  maxLength={2000}
                />
              </div>
            </div>
          </section>
        );
      })}

      <p className="hint px-1">Shared anonymously with your trainers — never linked to you.</p>

      <AnimatePresence>
        {error && (
          <motion.p
            role="alert"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-xl bg-rose-500/10 px-4 py-2.5 text-center text-sm font-medium text-rose-600 ring-1 ring-inset ring-rose-500/20 dark:text-rose-400"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      <button
        type="submit"
        className="btn-primary w-full py-3.5 text-base"
        disabled={!canSubmit || busy}
        aria-describedby="submit-help"
      >
        {busy ? (
          <>
            <span
              className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
              style={{ animationDuration: '0.6s' }}
              aria-hidden="true"
            />
            Submitting…
          </>
        ) : (
          missingLabel
        )}
      </button>
      <p id="submit-help" className="sr-only">
        Every class must have all parameters rated and a comment of at least {MIN_COMMENT} characters.
      </p>
    </form>
  );
}
