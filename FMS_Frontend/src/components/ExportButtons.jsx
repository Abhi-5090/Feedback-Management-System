import { useState } from 'react';
import { downloadExport } from '../api/endpoints.js';
import { useToast } from './Toast.jsx';
import Icon from './Icon.jsx';

/**
 * The "Excel" / "PDF" pair shown on every table and analytics view.
 * `path` is an export endpoint and `params` carries the CURRENT filters so the
 * download reflects exactly what the user is looking at.
 *
 * Both buttons disable during a download (never fire two exports at once), and
 * the busy one shows a spinner in place of its icon so the label stays put —
 * swapping the label text would make the button change width mid-press.
 */
export default function ExportButtons({
  path,
  params = {},
  baseName = 'feedback',
  size = 'md',
  /* `iconOnly` drops the words and keeps the file marks. Used inside table
     rows, where a column of "Excel  PDF" buttons costs more width than the
     data it sits beside. The accessible name is unchanged, and a title
     attribute gives sighted users the same words on hover — an icon-only
     control with no name is not a saving, it is a guess. */
  iconOnly = false,
}) {
  const [busy, setBusy] = useState(null);
  const toast = useToast();

  const run = async (format) => {
    if (busy) return;
    setBusy(format);
    try {
      await downloadExport(path, { ...params, format }, `${baseName}.${format === 'pdf' ? 'pdf' : 'xlsx'}`);
      toast.success(`${format === 'pdf' ? 'PDF' : 'Excel'} downloaded`);
    } catch (e) {
      toast.error(e.message || 'Export failed');
    } finally {
      setBusy(null);
    }
  };

  const pad = iconOnly
    ? '!px-2 !py-2'
    : size === 'sm'
      ? '!px-2.5 !py-1.5 text-xs'
      : '';

  const Btn = ({ format, label, icon, tone }) => (
    <button
      type="button"
      className={`btn-outline ${pad} ${iconOnly ? tone : ''}`}
      onClick={() => run(format)}
      disabled={Boolean(busy)}
      aria-label={`Export ${label}${busy === format ? ' (in progress)' : ''}`}
      title={`Export ${label}`}
    >
      {busy === format ? (
        <span
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current/30 border-t-current"
          style={{ animationDuration: '0.6s' }}
          aria-hidden="true"
        />
      ) : (
        <Icon name={icon} size={iconOnly ? 16 : 14} />
      )}
      {/* The label is kept in the DOM for screen readers even when hidden, so
          the button is never an unnamed glyph. */}
      <span className={iconOnly ? 'sr-only' : ''}>{label}</span>
    </button>
  );

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {/* Tinted only in icon-only mode: with the words gone, colour is what
          distinguishes them at a glance. Never colour alone — the title and
          the accessible name still say which is which. */}
      <Btn
        format="xlsx"
        label="Excel"
        icon="fileExcel"
        tone="!text-emerald-700 dark:!text-emerald-400"
      />
      <Btn format="pdf" label="PDF" icon="filePdf" tone="!text-rose-700 dark:!text-rose-400" />
    </div>
  );
}
