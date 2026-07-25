import InfoTooltip from './InfoTooltip.jsx';
import Icon from './Icon.jsx';

/**
 * A titled section card. The header sits on a faintly recessed band so a dense
 * dashboard reads as a set of discrete objects rather than one wash of white —
 * grouping is what makes a many-panel screen scannable.
 */
export default function Card({
  title,
  hint,
  subtitle,
  icon,
  actions,
  children,
  className = '',
  bodyClass = '',
  interactive = false,
}) {
  return (
    <section
      className={`${interactive ? 'card-interactive' : 'panel'} overflow-hidden ${className}`}
    >
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-ink">
              {icon && (
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
                  {/* Accepts either an icon NAME ("users") or a ready-made
                      element, so callers can pass a coloured/sized Icon when
                      they need one without this component growing props. */}
                  {typeof icon === 'string' ? <Icon name={icon} size={15} /> : icon}
                </span>
              )}
              <span className="truncate">{title}</span>
              {hint && <InfoTooltip text={hint} />}
            </h3>
            {subtitle && <p className="mt-0.5 truncate pl-9 text-xs text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={`p-5 ${bodyClass}`}>{children}</div>
    </section>
  );
}

/**
 * Empty states carry an action wherever one exists — a dead end that only says
 * "nothing here" wastes the moment the user is most ready to act.
 */
export function EmptyState({ title = 'Nothing here yet', hint, icon = 'inbox', action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-surface-2 text-subtle ring-1 ring-inset ring-line">
        {typeof icon === 'string' ? <Icon name={icon} size={24} /> : icon}
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-ink">{title}</p>
        {hint && <p className="mx-auto max-w-sm text-xs leading-relaxed text-muted">{hint}</p>}
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
