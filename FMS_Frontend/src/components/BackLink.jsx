import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';

/**
 * The way back from a detail page.
 *
 * Extracted because it existed twice, identically, in two drill-down views —
 * and a third copy was about to appear on the organization page. Three
 * near-copies of one control is how an interface starts to feel subtly
 * inconsistent: they drift a pixel and a word apart, nobody can say why the
 * app feels untidy, and the cause is invisible in any single file.
 *
 * Takes either an `onClick` (go back in history) or a `to` (a known
 * destination), because a detail page reached from two places needs the
 * first, and one that always belongs under the same parent reads better with
 * the second.
 */
export default function BackLink({ onClick, to, label = 'Back' }) {
  const className =
    'focus-ring -ml-1 mb-1.5 inline-flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-sm ' +
    'text-muted transition-colors duration-150 ease-out hover:text-ink';

  const inner = (
    <>
      <Icon name="chevronLeft" size={14} />
      {label}
    </>
  );

  if (to) {
    return (
      <Link to={to} className={className}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" className={className} onClick={onClick}>
      {inner}
    </button>
  );
}
