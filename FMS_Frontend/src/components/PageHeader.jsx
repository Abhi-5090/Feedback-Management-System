/**
 * Page title block. The subtitle is capped at ~65ch because a measure much
 * wider than that costs the reader the start of the next line.
 */
export default function PageHeader({ title, subtitle, action, eyebrow }) {
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
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}
