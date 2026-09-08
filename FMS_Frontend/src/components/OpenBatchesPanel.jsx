import Card, { EmptyState } from './Card.jsx';
import Icon from './Icon.jsx';

/**
 * A live "submitted / expected" progress row for one open batch.
 *
 * The bar fills with a CSS transform (scaleX), not an animated `width`.
 * Animating width forces layout on every frame; a transform is composited.
 * This panel polls every ~8s, so it re-animates constantly — exactly the case
 * where the cheap version matters.
 */
function BatchRow({ b }) {
  const capped = b.expectedCount > 0;
  const pct = capped ? Math.min(100, Math.round((b.submittedCount / b.expectedCount) * 100)) : 0;
  const full = capped && b.submittedCount >= b.expectedCount;

  return (
    <div className="rounded-xl border border-line bg-surface-2/30 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-ink">
            {/* "Live" tell — a quiet pulsing dot, not a spinning badge */}
            <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            {b.name}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted">
            {/* A batch now spans several classes — name them, compactly. */}
            {!b.classes?.length
              ? '—'
              : b.classes.length === 1
                ? `${b.classes[0].name} · ${(b.classes[0].mainTrainerNames || []).join(', ') || 'Unstaffed'}`
                : `${b.classCount} classes · ${b.classes.map((c) => c.name).join(', ')}`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="tnum text-sm font-bold leading-none text-ink">
            {b.submittedCount}
            <span className="font-medium text-muted"> / {capped ? b.expectedCount : '∞'}</span>
          </p>
          <span className={`mt-1.5 ${full ? 'chip-open' : 'chip-brand'}`}>
            {full ? 'Full' : capped ? `${pct}%` : 'Open'}
          </span>
        </div>
      </div>

      <div
        className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${b.name}: ${b.submittedCount} of ${capped ? b.expectedCount : 'unlimited'} responses`}
      >
        <div
          className={`h-full w-full origin-left rounded-full transition-transform duration-500 ease-out-expo ${
            full ? 'bg-emerald-500' : 'bg-brand-500'
          }`}
          style={{ transform: `scaleX(${pct / 100})` }}
        />
      </div>

      <p
        className={`mt-2 flex items-center gap-1.5 text-[11px] font-medium ${
          b.hasPasscode
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-rose-600 dark:text-rose-400'
        }`}
      >
        <Icon name={b.hasPasscode ? 'unlock' : 'lock'} size={12} />
        {b.hasPasscode ? 'Passcode active' : 'No passcode'}
      </p>
    </div>
  );
}

export default function OpenBatchesPanel({ batches, hint }) {
  return (
    <Card
      title="Live open batches"
      icon="ticket"
      hint={
        hint ||
        'Batches currently accepting feedback. The counter shows submitted vs. the expected class size, updating live every few seconds.'
      }
      subtitle={batches?.length ? `${batches.length} accepting responses now` : undefined}
    >
      {!batches?.length ? (
        <EmptyState
          title="No open batches"
          hint="Unlock a batch to open its feedback window and generate a passcode."
          icon="ticket"
        />
      ) : (
        // Now that this panel spans the full width, let the cards use it — two
        // columns across 1400px would leave each card absurdly wide.
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {batches.map((b) => (
            <BatchRow key={b.id} b={b} />
          ))}
        </div>
      )}
    </Card>
  );
}
