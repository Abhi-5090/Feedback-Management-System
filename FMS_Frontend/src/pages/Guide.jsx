import { useAuth } from '../auth/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Card from '../components/Card.jsx';
import Icon from '../components/Icon.jsx';

/**
 * "How it works" — the self-documenting explainer, moved off the dashboard.
 *
 * It lived at the top of both dashboards, which meant the people who needed it
 * least (daily users) paid for it on every visit while the people who needed it
 * most got it in a cramped strip. As its own page it can actually teach: the
 * pipeline, each role's boundaries, the anonymity guarantees, and a first-run
 * checklist. Framed by role — a trainer doesn't need the admin setup steps.
 */

const FLOW = [
  {
    icon: 'book',
    title: 'Class',
    body: 'A training subject — "React Fundamentals", "Aptitude Round 1". The admin creates it and assigns exactly one trainer, who becomes the only staff member who can read its feedback.',
  },
  {
    icon: 'users',
    title: 'Trainer',
    body: 'The person teaching. They sign in and see analytics for their own classes only. That boundary is enforced on the server for every request — never by hiding things in the interface.',
  },
  {
    icon: 'ticket',
    title: 'Batch',
    body: 'One cohort of a class in a time window ("FSD-Aug-2025"). The passcode and the open/closed window live on the batch, so each intake collects its own feedback separately.',
  },
  {
    icon: 'shield',
    title: 'Anonymous feedback',
    body: 'Students open a link, enter the batch passcode, rate every active parameter 1–5 and write one comment. No name, no email, no IP, no account — nothing that identifies them is ever stored.',
  },
  {
    icon: 'barChart',
    title: 'Analytics',
    body: 'Responses roll up into averages per parameter, trends over time and comment feeds — on the dashboards, in the class drill-downs, and in the Excel/PDF exports.',
  },
];

const SAFEGUARDS = [
  {
    icon: 'lock',
    title: 'The passcode',
    body: 'Generated fresh every time a batch is unlocked, and derived from the batch name so it looks like it belongs to that session while staying unguessable. Only a bcrypt hash is stored — the plaintext is shown to the admin once and can never be retrieved, only replaced.',
  },
  {
    icon: 'shield',
    title: 'One response per device',
    body: 'On submit the server stores an irreversible hash of a device signature in a separate collection from the feedback itself. A second submission from the same device is refused, but because the hash lives apart from the response, no comment can ever be traced back to a device — not even by an administrator with database access.',
  },
  {
    icon: 'activity',
    title: 'The live cap',
    body: 'When unlocking a batch the admin sets the expected class size. Submissions stop at that number and the counter updates live, so an unexpected spike is visible immediately rather than discovered later.',
  },
];

const ADMIN_STEPS = [
  { n: 1, t: 'Add your trainers', d: 'Create them one at a time, or import a whole cohort from Excel.', to: '/admin/trainers' },
  { n: 2, t: 'Create classes', d: 'Each class is assigned to exactly one trainer.', to: '/admin/classes' },
  { n: 3, t: 'Check your parameters', d: 'Eight ship by default. Rename, reorder or deactivate them — students rate every active one.', to: '/admin/parameters' },
  { n: 4, t: 'Create a batch and unlock it', d: 'Set the expected class size, then copy the passcode and student link. The passcode is shown once.', to: '/admin/batches' },
  { n: 5, t: 'Share the link with students', d: 'They need the link and the passcode. It takes them under a minute.', to: null },
  { n: 6, t: 'Watch the results', d: 'The dashboard updates live; Feedbacks breaks it down class by class.', to: '/admin/feedbacks' },
];

const TRAINER_STEPS = [
  { n: 1, t: 'Open your dashboard', d: 'Your ratings, trends and the classes assigned to you.', to: '/trainer' },
  { n: 2, t: 'Browse by class', d: 'Every class you teach, with its rating and its strongest and weakest parameter.', to: '/trainer/feedbacks' },
  { n: 3, t: 'Read what students wrote', d: 'Open a class to see per-parameter averages, the trend, and every comment.', to: null },
  { n: 4, t: 'Export it', d: 'Excel or PDF, scoped to your own data.', to: null },
];

export default function Guide() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const steps = isAdmin ? ADMIN_STEPS : TRAINER_STEPS;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Reference"
        title="How this system works"
        subtitle={
          isAdmin
            ? 'The whole model in one page — how classes, trainers, batches and anonymous responses fit together, and what protects the data.'
            : 'How feedback reaches you, what you can see, and what keeps your students anonymous.'
        }
      />

      {/* The pipeline */}
      <Card
        title="The flow"
        icon="compass"
        subtitle="Every number in this product comes out of this pipeline"
      >
        <ol className="stagger grid gap-3 lg:grid-cols-5">
          {FLOW.map((s, i) => (
            <li key={s.title} className="relative rounded-2xl border border-line bg-surface-2/40 p-4">
              <div className="mb-2.5 flex items-center gap-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-500/12 text-brand-600 dark:text-brand-400">
                  <Icon name={s.icon} size={17} />
                </span>
                <span className="text-sm font-bold text-ink">{s.title}</span>
              </div>
              <p className="text-xs leading-relaxed text-muted">{s.body}</p>
              {i < FLOW.length - 1 && (
                <span className="absolute -right-2.5 top-1/2 z-10 hidden -translate-y-1/2 text-subtle lg:block">
                  <Icon name="chevronRight" size={16} />
                </span>
              )}
            </li>
          ))}
        </ol>
      </Card>

      {/* Getting started */}
      <Card
        title={isAdmin ? 'Setting it up' : 'Using it'}
        icon="checkCircle"
        subtitle={isAdmin ? 'In order — each step needs the one before it' : 'What you can do'}
      >
        <ol className="space-y-2.5">
          {steps.map((s) => (
            <li
              key={s.n}
              className="flex items-start gap-3.5 rounded-2xl border border-line bg-surface-2/30 p-3.5"
            >
              <span className="tnum grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-500/12 text-xs font-bold text-brand-700 dark:text-brand-300">
                {s.n}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{s.t}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">{s.d}</p>
              </div>
              {s.to && (
                <a href={s.to} className="btn-outline shrink-0 !px-3 !py-1.5 text-xs">
                  Open
                  <Icon name="chevronRight" size={12} />
                </a>
              )}
            </li>
          ))}
        </ol>
      </Card>

      {/* Anonymity + integrity */}
      <Card
        title="What protects the data"
        icon="shield"
        subtitle="Why the responses can be trusted, and why they stay anonymous"
      >
        <div className="grid gap-3 md:grid-cols-3">
          {SAFEGUARDS.map((s) => (
            <div key={s.title} className="rounded-2xl border border-line p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
                  <Icon name={s.icon} size={15} />
                </span>
                {s.title}
              </p>
              <p className="mt-2.5 text-xs leading-relaxed text-muted">{s.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <span className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400">
            <Icon name="info" size={16} />
          </span>
          <p className="text-xs leading-relaxed text-muted">
            <span className="font-semibold text-ink">Being straight about the limits.</span> Because
            no identity is collected, uniqueness is best-effort by design: a determined student on a
            second device could submit twice. The three safeguards make that require deliberate
            effort, cap the damage at the expected class size, and keep it visible to the admin.
            That is the right trade for honest feedback — collecting identity would guarantee
            uniqueness and cost you the honesty.
          </p>
        </div>
      </Card>
    </div>
  );
}
