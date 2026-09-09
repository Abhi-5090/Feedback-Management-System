import { useCallback, useEffect, useMemo, useState } from 'react';
import ScrollHint from '../../components/ScrollHint.jsx';
import { useSearchParams } from 'react-router-dom';
import { AnalyticsAPI, ClassesAPI } from '../../api/endpoints.js';
import { useToast } from '../../components/Toast.jsx';
import Card, { EmptyState } from '../../components/Card.jsx';
import Modal from '../../components/Modal.jsx';
import { SkeletonBlock, SkeletonRows } from '../../components/Spinner.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import InfoTooltip from '../../components/InfoTooltip.jsx';
import Icon from '../../components/Icon.jsx';
import YearCards, { YearTotals } from '../../components/YearCards.jsx';
import SessionTable from '../../components/SessionTable.jsx';

/**
 * Classes — organised by YEAR GROUP, not by subject.
 *
 * A flat list of subjects was the wrong shape for this institution. There are
 * seven subjects but four distinct student populations, and a subject on its
 * own answers no question: "C Programming" is four separate first-year batches
 * with different mentors, so one row for it describes none of them. The year
 * group is the unit people actually think in, so it is the entry point, with
 * the batches inside one click down.
 *
 * NO MENTOR ON A SUBJECT. Mentors are assigned per batch — the same subject
 * runs with different teams for different cohorts — so the subject catalog
 * carries a name and a description and nothing else. Staffing lives on
 * Batches, where it is true.
 *
 * The selected year lives in the URL (`?year=First+Year`) so the view is
 * linkable and the browser Back button behaves.
 */
export default function Classes() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const selectedYear = params.get('year');

  const [years, setYears] = useState(null);
  const [sessions, setSessions] = useState(null);
  const [subjects, setSubjects] = useState(null);
  const [modal, setModal] = useState(null); // 'create' | subject | null
  const [form, setForm] = useState({ name: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [showCatalog, setShowCatalog] = useState(false);

  const load = useCallback(async () => {
    try {
      const [y, s, c] = await Promise.all([
        AnalyticsAPI.years(),
        AnalyticsAPI.sessions(),
        ClassesAPI.list({ limit: 200 }),
      ]);
      setYears(y);
      setSessions(s.sessions);
      setSubjects(c.classes);
    } catch (e) {
      toast.error(e.message);
      setYears([]);
      setSessions([]);
      setSubjects([]);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const selectYear = (year) => {
    if (year) params.set('year', year);
    else params.delete('year');
    setParams(params, { replace: true });
  };

  const yearSessions = useMemo(
    () => (sessions || []).filter((s) => s.yearGroup === selectedYear),
    [sessions, selectedYear]
  );

  /* Subjects that no batch runs. Worth surfacing: a subject nobody teaches
     collects no feedback, and it is usually a leftover rather than a plan. */
  const unusedSubjects = useMemo(() => {
    if (!subjects || !sessions) return [];
    const used = new Set(sessions.map((s) => s.classId));
    return subjects.filter((c) => !used.has(String(c._id)));
  }, [subjects, sessions]);

  const openCreate = () => {
    setForm({ name: '', description: '' });
    setModal('create');
  };
  const openEdit = (c) => {
    setForm({ name: c.name, description: c.description || '' });
    setModal(c);
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Give the subject a name.');
    setBusy(true);
    try {
      if (modal === 'create') {
        await ClassesAPI.create({ name: form.name.trim(), description: form.description });
        toast.success('Subject added');
      } else {
        await ClassesAPI.update(modal._id, { name: form.name.trim(), description: form.description });
        toast.success('Subject updated');
      }
      setModal(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    setBusy(true);
    try {
      await ClassesAPI.archive(archiveTarget._id, true);
      toast.success(`${archiveTarget.name} archived`);
      setArchiveTarget(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Catalog"
        title="Classes by year"
        subtitle="Each year group runs its own batches. Open a year to see its batches, the mentors on each, and their feedback."
        action={
          <button className="btn-outline" onClick={() => setShowCatalog((v) => !v)}>
            <Icon name="sliders" size={15} />
            {showCatalog ? 'Hide subjects' : 'Manage subjects'}
          </button>
        }
      />

      {!years ? (
        <>
          <SkeletonBlock height={92} className="rounded-2xl" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonBlock key={i} height={250} className="rounded-2xl" />
            ))}
          </div>
        </>
      ) : years.length === 0 ? (
        <Card>
          <EmptyState
            icon="graduation"
            title="No batches yet"
            hint="Add your subjects, then create a batch for each cohort and give it a year group. The cards here are built from those batches."
            action={
              <button className="btn-primary" onClick={openCreate}>
                + New subject
              </button>
            }
          />
        </Card>
      ) : (
        <>
          <YearTotals years={years} />

          <YearCards years={years} selected={selectedYear} onSelect={selectYear} basePath="/admin" />

          {/* ── Drill-down: the batches inside the chosen year ──────────── */}
          {selectedYear && (
            <Card
              title={`${selectedYear} — batches`}
              icon="ticket"
              subtitle={`${yearSessions.length} session${yearSessions.length === 1 ? '' : 's'} across ${
                new Set(yearSessions.map((s) => s.batchId)).size
              } batch${new Set(yearSessions.map((s) => s.batchId)).size === 1 ? '' : 'es'}`}
              actions={
                <button className="btn-ghost !px-2.5 !py-1.5 text-xs" onClick={() => selectYear(null)}>
                  <Icon name="x" size={13} />
                  Close
                </button>
              }
            >
              {!sessions ? (
                <SkeletonRows rows={5} />
              ) : (
                <SessionTable
                  sessions={yearSessions}
                  basePath="/admin"
                  emptyHint={`No batches in ${selectedYear} yet.`}
                />
              )}
            </Card>
          )}

          {!selectedYear && (
            <p className="flex items-center justify-center gap-1.5 rounded-xl bg-surface-2/60 px-4 py-3 text-xs text-muted">
              <Icon name="info" size={13} />
              Pick a year group above to see its batches, mentors and feedback.
            </p>
          )}
        </>
      )}

      {/* ── Subject catalog (collapsed by default) ─────────────────────── */}
      {showCatalog && (
        <Card
          title="Subjects"
          icon="book"
          subtitle="The catalog of things that get taught. Mentors are assigned per batch, not here."
          actions={
            <button className="btn-primary !px-3 !py-1.5 text-xs" onClick={openCreate}>
              + New subject
            </button>
          }
        >
          {unusedSubjects.length > 0 && (
            <p className="mb-3 flex items-start gap-2 rounded-xl bg-amber-500/10 px-3.5 py-2.5 text-xs ring-1 ring-inset ring-amber-500/20">
              <Icon name="alert" size={13} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-400" />
              <span className="text-ink">
                <span className="font-semibold">
                  {unusedSubjects.length} subject{unusedSubjects.length === 1 ? '' : 's'}
                </span>{' '}
                {unusedSubjects.length === 1 ? 'is' : 'are'} not used by any batch, so{' '}
                {unusedSubjects.length === 1 ? 'it collects' : 'they collect'} no feedback:{' '}
                {unusedSubjects.map((c) => c.name).join(', ')}.
              </span>
            </p>
          )}

          {!subjects ? (
            <SkeletonRows rows={4} />
          ) : subjects.length === 0 ? (
            <EmptyState icon="book" title="No subjects yet">
              Add the things you teach — C Programming, GenAI, and so on.
            </EmptyState>
          ) : (
            <ScrollHint>
              <table className="w-full min-w-[38rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-2">
                    <th className="th">Subject</th>
                    <th className="th">
                      <span className="inline-flex items-center gap-1.5">
                        Used by
                        <InfoTooltip text="How many batches run this subject, and in which year groups. Mentors are assigned per batch, so they are not shown here." />
                      </span>
                    </th>
                    <th className="th">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {subjects.map((c) => {
                    const mine = (sessions || []).filter((s) => s.classId === String(c._id));
                    const inYears = [...new Set(mine.map((s) => s.yearGroup))];
                    return (
                      <tr key={c._id} className="tr-hover border-b border-line last:border-0">
                        <td className="td">
                          <span className="block font-semibold text-ink">{c.name}</span>
                          {c.description && (
                            <span className="block truncate text-[11px] text-subtle">
                              {c.description}
                            </span>
                          )}
                        </td>
                        <td className="td">
                          {mine.length === 0 ? (
                            <span className="text-xs text-subtle">no batches</span>
                          ) : (
                            <span className="text-xs">
                              <span className="tnum font-semibold text-ink">{mine.length}</span>{' '}
                              <span className="text-muted">
                                batch{mine.length === 1 ? '' : 'es'}
                              </span>
                              <span className="block text-[11px] text-subtle">
                                {inYears.join(', ')}
                              </span>
                            </span>
                          )}
                        </td>
                        <td className="td text-right">
                          <div className="flex justify-end gap-1">
                            <button
                              className="btn-ghost !px-2.5 !py-1.5 text-xs"
                              onClick={() => openEdit(c)}
                            >
                              <Icon name="pencil" size={13} />
                              Edit
                            </button>
                            <button
                              className="btn-ghost !px-2.5 !py-1.5 text-xs text-rose-600 hover:!bg-rose-500/10 hover:!text-rose-700 dark:text-rose-400"
                              onClick={() => setArchiveTarget(c)}
                            >
                              <Icon name="trash" size={13} />
                              Archive
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollHint>
          )}
        </Card>
      )}

      {/* ── Create / edit a subject ─────────────────────────────────────── */}
      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal === 'create' ? 'New subject' : `Edit ${modal?.name || ''}`}
        description="A subject is a thing that gets taught. Which mentors teach it is decided per batch, because the same subject runs with different teams for different cohorts."
      >
        <form onSubmit={save} className="space-y-4">
          <div>
            <label className="label" htmlFor="subj-name">
              Name
            </label>
            <input
              id="subj-name"
              className="input"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="C Programming"
            />
          </div>
          <div>
            <label className="label" htmlFor="subj-desc">
              Description <span className="font-normal text-subtle">(optional)</span>
            </label>
            <textarea
              id="subj-desc"
              className="input min-h-20"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What this subject covers."
            />
          </div>
          <p className="flex items-start gap-1.5 rounded-xl bg-surface-2/60 px-3 py-2 text-[11px] text-muted">
            <Icon name="info" size={12} className="mt-0.5 shrink-0" />
            No mentor field here on purpose — assign main and support mentors when you create the
            batch, where each cohort gets its own team.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Saving…' : modal === 'create' ? 'Add subject' : 'Save'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── Archive confirm ────────────────────────────────────────────── */}
      <Modal
        open={Boolean(archiveTarget)}
        onClose={() => setArchiveTarget(null)}
        title={`Archive “${archiveTarget?.name}”?`}
        description="It disappears from every list and picker. Its batches and all their feedback are kept — archiving never destroys responses."
      >
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setArchiveTarget(null)}>
            Cancel
          </button>
          <button className="btn-danger" onClick={archive} disabled={busy}>
            {busy ? 'Archiving…' : 'Archive'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
