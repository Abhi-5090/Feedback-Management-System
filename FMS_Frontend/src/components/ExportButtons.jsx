import { useState } from 'react';
import { downloadExport } from '../api/endpoints.js';
import { useToast } from './Toast.jsx';

const DownloadIcon = () => (
  <svg width="13" height="13" viewBox="0 0 15 15" fill="none" aria-hidden="true">
    <path
      d="M7.5 2v8m0 0L4.8 7.3M7.5 10l2.7-2.7M2.5 12.5h10"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * The "Excel" / "PDF" pair shown on every table and analytics view.
 * `path` is an export endpoint and `params` carries the CURRENT filters so the
 * download reflects exactly what the user is looking at.
 *
 * Both buttons disable during a download (never fire two exports at once), and
 * the busy one shows a spinner in place of its icon so the label stays put —
 * swapping the label text would make the button change width mid-press.
 */
export default function ExportButtons({ path, params = {}, baseName = 'feedback', size = 'md' }) {
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

  const pad = size === 'sm' ? '!px-2.5 !py-1.5 text-xs' : '';

  const Btn = ({ format, label }) => (
    <button
      type="button"
      className={`btn-outline ${pad}`}
      onClick={() => run(format)}
      disabled={Boolean(busy)}
      aria-label={`Export ${label}${busy === format ? ' (in progress)' : ''}`}
    >
      {busy === format ? (
        <span
          className="h-3 w-3 animate-spin rounded-full border-2 border-current/30 border-t-current"
          style={{ animationDuration: '0.6s' }}
          aria-hidden="true"
        />
      ) : (
        <DownloadIcon />
      )}
      {label}
    </button>
  );

  return (
    <div className="flex items-center gap-2">
      <Btn format="xlsx" label="Excel" />
      <Btn format="pdf" label="PDF" />
    </div>
  );
}
