import { useEffect, useState, useCallback } from 'react';
import { AuditAPI } from '../../api/endpoints.js';
import { useToast } from '../../components/Toast.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Card, { EmptyState } from '../../components/Card.jsx';
import { SkeletonRows } from '../../components/Spinner.jsx';
import Icon from '../../components/Icon.jsx';
import Pagination from '../../components/Pagination.jsx';

/**
 * Audit trail.
 *
 * Paginated and filtered SERVER-side: this collection only grows, and an
 * institution six months in will have tens of thousands of entries. Filtering
 * in the browser would mean shipping all of them first.
 */

const LABELS = {
  'auth.login': 'Signed in',
  'auth.password_changed': 'Changed own password',
  'auth.password_reset': 'Reset password via email',
  'trainer.create': 'Created trainer',
  'trainer.update': 'Updated trainer',
  'trainer.bulk_import': 'Imported trainers',
  'class.create': 'Created class',
  'class.update': 'Updated class',
  'class.archive': 'Archived class',
  'class.restore': 'Restored class',
  'parameter.create': 'Added parameter',
  'parameter.update': 'Updated parameter',
  'parameter.delete': 'Removed parameter',
  'batch.create': 'Created batch',
  'batch.unlock': 'Unlocked batch',
  'batch.lock': 'Locked batch',
  'batch.rotate_passcode': 'Rotated passcode',
  'batch.archive': 'Archived batch',
  'batch.restore': 'Restored batch',
  'export.download': 'Exported data',
};

/** Icon + tone per action family, so the log is scannable by shape not just text. */
function actionStyle(action) {
  if (action.startsWith('auth.')) return { icon: 'user', tone: 'text-sky-600 dark:text-sky-400 bg-sky-500/12' };
  if (action.startsWith('export.')) return { icon: 'download', tone: 'text-violet-600 dark:text-violet-400 bg-violet-500/12' };
  if (action.includes('archive') || action.includes('delete'))
    return { icon: 'trash', tone: 'text-rose-600 dark:text-rose-400 bg-rose-500/12' };
  if (action.includes('unlock')) return { icon: 'unlock', tone: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/12' };
  if (action.includes('lock') || action.includes('passcode'))
    return { icon: 'lock', tone: 'text-amber-600 dark:text-amber-400 bg-amber-500/12' };
  if (action.startsWith('trainer.')) return { icon: 'users', tone: 'text-brand-600 dark:text-brand-400 bg-brand-500/12' };
  if (action.startsWith('class.')) return { icon: 'book', tone: 'text-brand-600 dark:text-brand-400 bg-brand-500/12' };
  return { icon: 'activity', tone: 'text-muted bg-surface-2' };
}

function when(d) {
  const date = new Date(d);
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return date.toLocaleDateString();
}

export default function Audit() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await AuditAPI.list({ page, limit: 25, ...(action ? { action } : {}), ...(q ? { q } : {}) }));
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [page, action, q, toast]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0); // debounce only the free-text search
    return () => clearTimeout(t);
  }, [load, q]);

  // Any filter change resets to the first page — otherwise you can land on an
  // empty page 7 of a two-page result.
  useEffect(() => setPage(1), [action, q]);

  const entries = data?.entries || [];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Security"
        title="Audit trail"
        subtitle="Every consequential action — who did it, to what, and when. Entries are written once and never modified."
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle">
            <Icon name="search" size={15} />
          </span>
          <label htmlFor="au-q" className="sr-only">Search the audit trail</label>
          <input
            id="au-q"
            className="input pl-10"
            placeholder="Search by person, item or action…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <label htmlFor="au-action" className="sr-only">Filter by action</label>
        <select
          id="au-action"
          className="input w-auto"
          value={action}
          onChange={(e) => setAction(e.target.value)}
        >
          <option value="">All actions</option>
          {(data?.filters?.actions || []).map((a) => (
            <option key={a} value={a}>{LABELS[a] || a}</option>
          ))}
        </select>
        {(action || q) && (
          <button className="btn-ghost !px-3 !py-2 text-xs" onClick={() => { setAction(''); setQ(''); }}>
            Clear
          </button>
        )}
      </div>

      <Card title="Activity" icon="activity" bodyClass="p-0"
        subtitle={data ? `${data.total} recorded ${data.total === 1 ? 'event' : 'events'}` : undefined}>
        {loading && !data ? (
          <div className="p-5"><SkeletonRows rows={6} /></div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={action || q ? 'search' : 'activity'}
            title={action || q ? 'No matching activity' : 'Nothing recorded yet'}
            hint={
              action || q
                ? 'Try a different search or clear the filters.'
                : 'Actions like unlocking a batch or exporting data will appear here.'
            }
            action={action || q ? (
              <button className="btn-outline" onClick={() => { setAction(''); setQ(''); }}>Clear filters</button>
            ) : null}
          />
        ) : (
          <>
            <ul className="divide-y divide-line/60">
              {entries.map((e) => {
                const st = actionStyle(e.action);
                return (
                  <li key={e._id} className="flex items-start gap-3.5 px-5 py-3.5">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${st.tone}`}>
                      <Icon name={st.icon} size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      {/* Suppress the object when it IS the actor — auth events
                          target the signing-in user, and "Alice signed in Alice"
                          reads like a bug even though the data is correct. */}
                      <p className="text-sm text-ink">
                        <span className="font-semibold">{e.actorName}</span>{' '}
                        <span className="text-muted">{(LABELS[e.action] || e.action).toLowerCase()}</span>
                        {e.entityName && e.entityName !== e.actorName && (
                          <> <span className="font-medium">{e.entityName}</span></>
                        )}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-subtle">
                        <span className="capitalize">{e.actorRole}</span>
                        {e.actorEmail && <><span>·</span><span className="truncate">{e.actorEmail}</span></>}
                        {e.ip && <><span>·</span><span>{e.ip}</span></>}
                        {e.meta && Object.keys(e.meta).length > 0 && (
                          <>
                            <span>·</span>
                            <span>
                              {Object.entries(e.meta).map(([k, v]) => `${k}: ${v}`).join(', ')}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                    <time
                      dateTime={e.createdAt}
                      title={new Date(e.createdAt).toLocaleString()}
                      className="shrink-0 text-[11px] text-subtle"
                    >
                      {when(e.createdAt)}
                    </time>
                  </li>
                );
              })}
            </ul>

            {data && (
              <Pagination
                page={data.page}
                pages={data.pages}
                setPage={setPage}
                from={(data.page - 1) * data.limit + 1}
                to={Math.min(data.page * data.limit, data.total)}
                total={data.total}
                unit="events"
              />
            )}
          </>
        )}
      </Card>
    </div>
  );
}
