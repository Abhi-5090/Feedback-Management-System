import { useMemo } from 'react';
import Icon from './Icon.jsx';

/**
 * Compact search input designed to sit in a Card's `actions` slot — i.e. the
 * top-right corner of the table it filters.
 *
 * Deliberately NOT debounced. Filtering happens in memory over a list that is
 * already loaded, so results are instant; a debounce would only add lag to
 * something that has no network cost.
 */
export default function TableSearch({ value, onChange, placeholder = 'Search…', label = 'Search' }) {
  return (
    <div className="relative w-full sm:w-64">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle">
        <Icon name="search" size={14} />
      </span>
      <label htmlFor={`search-${label}`} className="sr-only">
        {label}
      </label>
      <input
        id={`search-${label}`}
        type="search"
        className="input !py-2 pl-9 pr-9 text-sm"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="focus-ring absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-subtle transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
        >
          <Icon name="x" size={13} />
        </button>
      )}
    </div>
  );
}

/**
 * Filter a list by a free-text query.
 *
 * Matching rules, chosen so the results are never surprising:
 *  - case-insensitive, and the query is trimmed;
 *  - the query is split on whitespace and EVERY term must match somewhere in
 *    the row ("asha react" finds Asha's React class, not everyone named Asha
 *    plus everyone teaching React);
 *  - each row is reduced to one searchable string by `fields`, so a term can
 *    match a name, an email or a status without the caller writing per-field
 *    logic;
 *  - null/undefined fields are skipped rather than stringified into "null",
 *    which would otherwise make a search for "null" match empty rows.
 */
export function useSearchFilter(items, query, fields) {
  return useMemo(() => {
    const terms = String(query || '')
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    if (!items || terms.length === 0) return items || [];

    return items.filter((item) => {
      const haystack = fields(item)
        .filter((v) => v != null && v !== false)
        .join(' ')
        .toLowerCase();
      return terms.every((t) => haystack.includes(t));
    });
  }, [items, query, fields]);
}
