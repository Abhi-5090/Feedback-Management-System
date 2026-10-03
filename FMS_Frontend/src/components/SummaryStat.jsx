import Icon from './Icon.jsx';
import InfoTooltip from './InfoTooltip.jsx';

/**
 * One figure in a page's summary strip.
 *
 * WHY THIS EXISTS. Four pages each grew their own version of the same thing —
 * `Metric` in Trainers, `Fig` in YearCards, and inline markup in Parameters
 * and Batches — and they disagreed on the two decisions that matter:
 *
 *   - the icon was 8×8 on one page and 9×9 on the next,
 *   - and Classes put the LABEL above the value while every other page put the
 *     value first.
 *
 * The second is the one a reader feels. The number is the content and the
 * label is its caption; leading with the caption makes the eye read a word
 * before it reaches the thing it came for, and on a screen where three pages
 * do it one way and the fourth does not, the fourth simply looks wrong without
 * the reader being able to say why.
 *
 * Uniformity is not tidiness here. The same shape in the same place on every
 * page is what lets someone move between them without re-learning where to
 * look.
 *
 * @param {string}  label  short caption, rendered uppercase
 * @param {*}       value  the figure itself
 * @param {string}  icon   icon name
 * @param {string}  sub    optional qualifier under the value ("none open")
 * @param {string}  tone       icon tone: 'brand' | 'positive' | 'warn' | 'neutral'
 * @param {string}  valueTone  colours the FIGURE when it carries a judgement
 *                             ('danger' for a deactivated count, 'muted' for a
 *                             zero that is simply the resting state)
 * @param {node}    prefix     rendered before the label (a live dot, say)
 * @param {string}  hint       optional tooltip text
 */
const TONES = {
  brand: 'bg-brand-500/12 text-brand-600 dark:text-brand-400',
  positive: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
  warn: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
  neutral: 'bg-surface-2 text-muted',
};

const VALUE_TONES = {
  danger: 'text-rose-600 dark:text-rose-400',
  muted: 'text-subtle',
  default: 'text-ink',
};

export default function SummaryStat({
  label, value, icon, sub, tone = 'neutral', valueTone = 'default', prefix, hint,
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-4">
      {icon && (
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${TONES[tone] || TONES.neutral}`}>
          <Icon name={icon} size={17} />
        </span>
      )}
      <div className="min-w-0">
        {/* Value first, always. */}
        <p className={`text-display-sm tnum leading-none ${VALUE_TONES[valueTone] || VALUE_TONES.default}`}>
          {value}
        </p>
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
          {prefix}
          <span className="truncate">{label}</span>
          {hint && <InfoTooltip text={hint} />}
        </p>
        {sub && <p className="mt-0.5 truncate text-[11px] text-subtle">{sub}</p>}
      </div>
    </div>
  );
}

/**
 * The strip itself: stats divided by hairlines, wrapping to a column on narrow
 * screens. A separate export so a page cannot get the container wrong while
 * getting the contents right.
 */
export function SummaryStrip({ children, className = '' }) {
  return (
    <div className={`panel grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x ${className}`}>
      {children}
    </div>
  );
}
