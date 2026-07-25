import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useTheme } from '../../theme/ThemeContext.jsx';
import EnterPasscode from './EnterPasscode.jsx';
import FeedbackForm from './FeedbackForm.jsx';
import ThankYou from './ThankYou.jsx';
import Icon from '../../components/Icon.jsx';

/**
 * Anonymous student feedback — three calm steps, mobile-first. Entered via a
 * per-batch link (/feedback/:batchId). No login, no personal data.
 *
 *   1. Enter passcode  → verify, receive active parameters + a session token
 *   2. Rate + comment  → submit once
 *   3. Thank-you       → prevents resubmission
 *
 * Motion note: this is a once-in-a-session flow, so it earns more delight than
 * the dashboards do. Steps slide along the axis of travel (forward = in from
 * the right) so the direction reinforces progress; a dashboard seen 50×/day
 * would get none of this.
 */
const STEPS = ['Passcode', 'Your feedback', 'Done'];

export default function StudentFlow() {
  const { batchId } = useParams();
  const { theme, toggle } = useTheme();
  const [step, setStep] = useState(0);
  const [session, setSession] = useState(null); // { batchName, parameters, sessionToken }
  const [result, setResult] = useState(null);
  const reduce = useReducedMotion();

  const onVerified = (data) => { setSession(data); setStep(1); };
  const onSubmitted = (res) => { setResult(res); setStep(2); };

  // Reduced motion keeps the crossfade (it aids comprehension) but drops travel.
  const variants = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, x: 28 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: -28 },
      };

  return (
    <div className="relative min-h-screen overflow-hidden bg-surface">
      {/* Ambient accent — decorative depth, never interactive */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-32 -top-40 h-80 w-80 rounded-full bg-brand-500/20 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-40 -right-24 h-96 w-96 rounded-full bg-violet-500/10 blur-3xl"
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-xl flex-col px-4 py-6 sm:py-10">
        {/* Header */}
        <header className="mb-7 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-brand">
              <Icon name="activity" size={17} strokeWidth={2} />
            </span>
            <div className="leading-tight">
              <p className="text-sm font-bold text-ink">Session feedback</p>
              {session?.batchName && (
                <p className="text-[11px] text-muted">{session.batchName}</p>
              )}
            </div>
          </div>
          <button
            onClick={toggle}
            className="btn-ghost !px-2.5 !py-2"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
          </button>
        </header>

        <Stepper step={step} />

        <div className="mt-7 flex-1">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              initial={variants.initial}
              animate={variants.animate}
              exit={variants.exit}
              transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
            >
              {step === 0 && <EnterPasscode batchId={batchId} onVerified={onVerified} />}
              {step === 1 && (
                <FeedbackForm
                  batchId={batchId}
                  session={session}
                  onSubmitted={onSubmitted}
                  onDuplicate={() => setStep(2)}
                />
              )}
              {step === 2 && <ThankYou result={result} batchName={session?.batchName} />}
            </motion.div>
          </AnimatePresence>
        </div>

        <p className="mt-8 flex items-center justify-center gap-1.5 text-center text-[11px] leading-relaxed text-muted">
          <Icon name="lock" size={12} />
          Anonymous — your name, IP and identity are never stored.
        </p>
      </div>
    </div>
  );
}

/**
 * Progress stepper. The connector fills with a transform-based scaleX rather
 * than an animated width: width triggers layout on every frame, transform
 * doesn't, and only one of the two can run on the compositor.
 */
function Stepper({ step }) {
  return (
    <nav aria-label="Progress">
      <ol className="flex items-center gap-2">
        {STEPS.map((label, i) => {
          const done = i < step;
          const current = i === step;
          return (
            <li key={label} className="flex flex-1 items-center gap-2">
              <div
                className={`flex items-center gap-2 transition-colors duration-200 ${
                  done || current ? 'text-brand-600 dark:text-brand-400' : 'text-subtle'
                }`}
              >
                <span
                  aria-current={current ? 'step' : undefined}
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold transition-[background-color,border-color,color] duration-200 ease-out-expo ${
                    done
                      ? 'bg-brand-600 text-white'
                      : current
                        ? 'border-2 border-brand-600 text-brand-600 dark:border-brand-400 dark:text-brand-400'
                        : 'border border-line text-subtle'
                  }`}
                >
                  {done ? (
                    <Icon name="check" size={11} strokeWidth={2.6} />
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="hidden text-xs font-semibold sm:block">{label}</span>
                <span className="sr-only">
                  {label}
                  {done ? ' (completed)' : current ? ' (current step)' : ''}
                </span>
              </div>

              {i < STEPS.length - 1 && (
                <div className="h-0.5 flex-1 overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full origin-left rounded-full bg-brand-600 transition-transform duration-500 ease-out-expo"
                    style={{ transform: `scaleX(${done ? 1 : 0})` }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
