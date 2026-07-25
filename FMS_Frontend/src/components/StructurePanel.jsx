import { useState, useEffect } from 'react';
import Icon from './Icon.jsx';

/**
 * The self-documenting "how this app works" map. Its whole job is that a person
 * who has never seen the system understands the data model and flow just by
 * reading it: Class → Trainer → Batch (passcode-gated) → anonymous Student
 * feedback → Analytics. Framed slightly differently for admin vs trainer.
 *
 * Collapsible, and the preference is remembered: an explainer is invaluable on
 * day one and pure noise on day thirty.
 */

const STEPS = [
  { icon: 'book', title: 'Class', body: 'A training subject (e.g. "React Fundamentals"), assigned by the admin to one trainer.' },
  { icon: 'users', title: 'Trainer', body: 'Teaches assigned classes and sees feedback for only those classes.' },
  { icon: 'ticket', title: 'Batch', body: 'A cohort of a class in a time window. The passcode and open/closed window live here.' },
  { icon: 'shield', title: 'Anonymous feedback', body: 'Students enter the passcode, rate every parameter (1–5) and leave one comment — no identity stored.' },
  { icon: 'barChart', title: 'Analytics', body: 'Averages, trends and comments roll up into these dashboards and Excel/PDF exports.' },
];

const NOTES = [
  { icon: 'lock', title: 'Passcode', body: 'Recognizable-but-random, regenerated on every unlock. Stored hashed; shown to the admin once.' },
  { icon: 'shield', title: 'Device lock', body: 'Blocks a second submission from the same device via an irreversible hash kept separate from the feedback, so anonymity holds.' },
  { icon: 'activity', title: 'Live cap', body: 'Admin sets the expected class size; submissions stop at the cap and the counter is watched live.' },
];

const KEY = 'fms_guide_open';

export default function StructurePanel({ role = 'admin' }) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(KEY);
    setOpen(stored === null ? true : stored === '1');
  }, []);

  const toggle = () => {
    setOpen((o) => {
      localStorage.setItem(KEY, o ? '0' : '1');
      return !o;
    });
  };

  return (
    <div className="panel overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="structure-body"
        className="focus-ring flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors duration-150 hover:bg-surface-2/50"
      >
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-500/12 text-brand-600 dark:text-brand-400">
            <Icon name="compass" size={17} />
          </span>
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-ink">
              How this system works
              <span className="chip-brand !py-0.5 text-[10px]">Guide</span>
            </h3>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              {role === 'admin'
                ? 'The whole flow at a glance — every number on this page comes from this pipeline.'
                : 'Your view is scoped to the classes assigned to you. Here is where your feedback comes from.'}
            </p>
          </div>
        </div>
        <span
          className="shrink-0 text-muted transition-transform duration-200 ease-out-expo"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          <Icon name="chevronDown" size={17} />
        </span>
      </button>

      {open && (
        <div id="structure-body" className="border-t border-line p-5">
          <ol className="stagger grid gap-2.5 lg:grid-cols-5">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative rounded-2xl border border-line bg-surface-2/40 p-3.5">
                <div className="mb-2 flex items-center gap-2">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-card text-brand-600 ring-1 ring-inset ring-line dark:text-brand-400">
                    <Icon name={s.icon} size={15} />
                  </span>
                  <span className="text-xs font-bold text-ink">{s.title}</span>
                </div>
                <p className="text-[11px] leading-relaxed text-muted">{s.body}</p>
                {i < STEPS.length - 1 && (
                  <span className="absolute -right-2 top-1/2 z-10 hidden -translate-y-1/2 text-subtle lg:block">
                    <Icon name="chevronRight" size={14} />
                  </span>
                )}
              </li>
            ))}
          </ol>

          <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
            {NOTES.map((n) => (
              <div key={n.title} className="rounded-2xl border border-dashed border-line p-3.5">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                  <span className="text-subtle">
                    <Icon name={n.icon} size={13} />
                  </span>
                  {n.title}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">{n.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
