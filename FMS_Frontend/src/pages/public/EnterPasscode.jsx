import { useState, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { PublicAPI } from '../../api/endpoints.js';
import Icon from '../../components/Icon.jsx';

/**
 * Step 1 — the passcode gate (Layer 1).
 *
 * A wrong passcode gets a short horizontal shake. Shake is one of the few
 * places a "negative" animation earns its keep: it maps to the real-world
 * headshake, needs no reading, and is over in 400ms. It runs once per failed
 * attempt and is suppressed under reduced-motion, where the red copy carries
 * the message on its own.
 */
export default function EnterPasscode({ batchId, onVerified }) {
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(0);
  const inputRef = useRef(null);
  const reduce = useReducedMotion();

  const fail = (msg) => {
    setError(msg);
    setShake((n) => n + 1);
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!passcode.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const data = await PublicAPI.verifyPasscode(batchId, passcode.trim());
      if (data.full) {
        fail('This session has already collected all its responses. Thank you!');
        return;
      }
      onVerified(data);
    } catch (err) {
      fail(err.message || 'Could not verify the passcode.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      key={shake}
      animate={shake && !reduce ? { x: [0, -9, 8, -6, 4, 0] } : undefined}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="card p-6 sm:p-7"
    >
      <div className="mb-6 text-center">
        {/* CSS entrance — decorative, and must never gate the content behind it */}
        <div className="animate-scale-in mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand-500/12 text-brand-600 ring-1 ring-inset ring-brand-500/20 dark:text-brand-400">
          <Icon name="ticket" size={24} />
        </div>
        <h2 className="text-lg font-bold tracking-tight text-ink">Enter the batch passcode</h2>
        <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-muted">
          Your trainer shared a short code for this session. It takes under a minute.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="passcode" className="sr-only">
            Batch passcode
          </label>
          <input
            id="passcode"
            ref={inputRef}
            autoFocus
            value={passcode}
            onChange={(e) => {
              setPasscode(e.target.value.toUpperCase());
              if (error) setError('');
            }}
            placeholder="FA2@K73X"
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? 'passcode-error' : undefined}
            className="input py-3.5 text-center font-mono text-lg tracking-[0.28em] placeholder:tracking-[0.28em]"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck="false"
            autoComplete="off"
          />
          <AnimatePresence>
            {error && (
              <motion.p
                id="passcode-error"
                role="alert"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                className="mt-2.5 text-center text-sm font-medium text-rose-600 dark:text-rose-400"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        <button
          type="submit"
          className="btn-primary w-full py-3.5 text-base"
          disabled={busy || !passcode.trim()}
        >
          {busy ? (
            <>
              <span
                className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
                style={{ animationDuration: '0.6s' }}
                aria-hidden="true"
              />
              Checking…
            </>
          ) : (
            'Continue'
          )}
        </button>
      </form>
    </motion.div>
  );
}
