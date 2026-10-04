/**
 * Page title block. The subtitle is capped at ~65ch because a measure much
 * wider than that costs the reader the start of the next line.
 */
export default function PageHeader({ title, subtitle, action, actions, eyebrow }) {
  /* `actions` is accepted as well as `action` because Card and Hero both use
     the plural, and an unknown prop in React fails SILENTLY: the page still
     renders, the build still passes, every test still passes, and the primary
     action is simply absent. That happened on the Phases page — there was no
     way to create a phase at all. Taking both spellings removes the trap
     rather than relying on everyone remembering which component is which. */
  const right = action ?? actions;
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400">
            {eyebrow}
          </p>
        )}
        <h1 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">{title}</h1>
        {subtitle && (
          <p className="mt-1 max-w-[65ch] text-sm leading-relaxed text-muted">{subtitle}</p>
        )}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  );
}
