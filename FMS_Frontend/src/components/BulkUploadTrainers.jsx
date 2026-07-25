import { useState, useRef, useCallback } from 'react';
import Modal from './Modal.jsx';
import Icon from './Icon.jsx';
import { useToast } from './Toast.jsx';
import { TrainersAPI, downloadExport } from '../api/endpoints.js';

const MIN_PASSWORD = 6;

/**
 * Bulk-import trainers from an Excel workbook.
 *
 * Three explicit steps — choose → REVIEW → import — rather than "upload and
 * hope". A spreadsheet is opaque until parsed, so the admin sees exactly which
 * rows will be created and which are broken BEFORE anything is written. Fixing
 * a typo is cheap at that point and expensive afterwards.
 *
 * Parsing runs on the SERVER (ExcelJS, already a backend dependency). Doing it
 * in the browser would have meant shipping a ~1MB spreadsheet parser in the
 * bundle and re-validating server-side anyway.
 *
 * Every imported account is created with ONE default password the admin sets
 * here, and is flagged to change it on first sign-in.
 */
export default function BulkUploadTrainers({ open, onClose, onImported }) {
  const toast = useToast();
  const fileRef = useRef(null);

  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState(null); // { rows, summary, truncated }
  const [error, setError] = useState('');
  const [parsing, setParsing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState(null);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);

  const reset = useCallback(() => {
    setFileName('');
    setPreview(null);
    setError('');
    setResult(null);
    setParsing(false);
    setBusy(false);
    setPassword('');
    setConfirm('');
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  const close = () => {
    onClose();
    // Clear after the exit animation so the panel doesn't visibly empty first.
    setTimeout(reset, 220);
  };

  /** Read the workbook as base64 and hand it to the server to parse. */
  const readFile = useCallback(
    async (file) => {
      if (!file) return;
      if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
        setError('Please choose an Excel (.xlsx) or .csv file.');
        return;
      }
      setError('');
      setResult(null);
      setPreview(null);
      setFileName(file.name);
      setParsing(true);

      try {
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          // readAsDataURL gives "data:...;base64,XXXX" — strip the prefix.
          reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
          reader.onerror = () => reject(new Error('That file could not be read.'));
          reader.readAsDataURL(file);
        });

        const data = await TrainersAPI.bulkPreview(base64, file.name);
        setPreview(data);
        if (data.truncated) {
          toast.info(`Only the first ${data.maxRows} rows were read.`);
        }
      } catch (e) {
        setError(e.message || 'That file could not be read.');
        setFileName('');
      } finally {
        setParsing(false);
      }
    },
    [toast]
  );

  const downloadTemplate = async () => {
    try {
      await downloadExport('/trainers/bulk/template', {}, 'trainers-template.xlsx');
    } catch (e) {
      toast.error(e.message || 'Could not download the template');
    }
  };

  const validRows = preview?.rows?.filter((r) => !r.error) || [];
  const pwTooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const pwMismatch = confirm.length > 0 && password !== confirm;
  const canImport =
    validRows.length > 0 && password.length >= MIN_PASSWORD && password === confirm && !busy;

  const submit = async () => {
    if (!canImport) return;
    setBusy(true);
    try {
      const res = await TrainersAPI.bulk(
        validRows.map((r) => ({
          firstName: r.firstName,
          lastName: r.lastName,
          email: r.email,
          phone: r.phone,
          row: r.row,
        })),
        password
      );
      setResult(res);
      if (res.summary.created > 0) {
        toast.success(
          `${res.summary.created} trainer${res.summary.created === 1 ? '' : 's'} imported`
        );
        onImported?.();
      } else {
        toast.error('No trainers were imported — see the details below.');
      }
    } catch (e) {
      toast.error(e.message || 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import trainers from Excel"
      description="Upload a spreadsheet to create many trainers at once, then set one password they all start with."
      maxWidth="max-w-3xl"
    >
      {result ? (
        /* ── STEP 3: results ──────────────────────────────────────────── */
        <div className="space-y-4">
          <div className="grid gap-2.5 sm:grid-cols-3">
            <SummaryTile label="Rows sent" value={result.summary.total} icon="inbox" tone="brand" />
            <SummaryTile label="Created" value={result.summary.created} icon="checkCircle" tone="emerald" />
            <SummaryTile label="Skipped" value={result.summary.skipped} icon="alert" tone="amber" />
          </div>

          {result.summary.created > 0 && (
            <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                <Icon name="checkCircle" size={15} />
                All {result.summary.created} accounts share the password you set
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">
                Share it with them privately. Each account is flagged to change this password on
                first sign-in, so the shared secret is only a starting credential.
              </p>
            </div>
          )}

          {result.skipped.length > 0 && (
            <ResultTable
              title="Skipped rows"
              rows={result.skipped}
              columns={[
                { key: 'row', label: 'Row', numeric: true },
                { key: 'email', label: 'Email' },
                { key: 'reason', label: 'Reason', tone: 'error' },
              ]}
            />
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-outline" onClick={reset}>
              Import another file
            </button>
            <button type="button" className="btn-primary" onClick={close}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* ── STEP 1: choose a file ───────────────────────────────────── */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              readFile(e.dataTransfer.files?.[0]);
            }}
            className={`rounded-2xl border-2 border-dashed p-6 text-center transition-colors duration-150 ${
              dragging ? 'border-brand-500 bg-brand-500/5' : 'border-line bg-surface-2/40'
            }`}
          >
            <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-card text-brand-600 ring-1 ring-inset ring-line dark:text-brand-400">
              <Icon name={parsing ? 'refresh' : 'inbox'} size={22} className={parsing ? 'animate-spin' : ''} />
            </span>
            <p className="text-sm font-semibold text-ink">
              {parsing ? 'Reading workbook…' : fileName || 'Drop an Excel file here, or choose one'}
            </p>
            <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted">
              The first row must be headers:{' '}
              <span className="font-medium text-ink">First Name</span>,{' '}
              <span className="font-medium text-ink">Last Name</span>,{' '}
              <span className="font-medium text-ink">Email</span>,{' '}
              <span className="font-medium text-ink">Mobile Number</span>.
            </p>

            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="sr-only"
              onChange={(e) => readFile(e.target.files?.[0])}
            />
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                className="btn-outline !py-2 text-xs"
                onClick={() => fileRef.current?.click()}
                disabled={parsing}
              >
                <Icon name="inbox" size={13} />
                Choose file
              </button>
              <button type="button" className="btn-ghost !py-2 text-xs" onClick={downloadTemplate}>
                <Icon name="download" size={13} />
                Download Excel template
              </button>
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-xl bg-rose-500/10 px-4 py-2.5 text-sm font-medium text-rose-600 ring-1 ring-inset ring-rose-500/20 dark:text-rose-400"
            >
              <Icon name="alert" size={15} className="mt-0.5" />
              {error}
            </p>
          )}

          {/* ── STEP 2: review + default password ───────────────────────── */}
          {preview && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="chip-open">
                  <Icon name="checkCircle" size={12} />
                  {preview.summary.valid} ready
                </span>
                {preview.summary.invalid > 0 && (
                  <span className="chip bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-300">
                    <Icon name="alert" size={12} />
                    {preview.summary.invalid} with errors
                  </span>
                )}
                <span className="text-xs text-muted">Rows with errors are skipped, not imported.</span>
              </div>

              <div className="max-h-56 overflow-auto rounded-xl ring-1 ring-inset ring-line">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-2">
                    <tr>
                      <th className="th !py-2">Row</th>
                      <th className="th !py-2">Name</th>
                      <th className="th !py-2">Email</th>
                      <th className="th !py-2">Mobile</th>
                      <th className="th !py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr key={r.row} className="border-t border-line/60">
                        <td className="td tnum !py-2 text-muted">{r.row}</td>
                        <td className="td !py-2">
                          {`${r.firstName} ${r.lastName}`.trim() || <span className="text-subtle">—</span>}
                        </td>
                        <td className="td !py-2">{r.email || <span className="text-subtle">—</span>}</td>
                        <td className="td tnum !py-2 text-muted">
                          {r.phone || <span className="text-subtle">—</span>}
                        </td>
                        <td className="td !py-2">
                          {r.error ? (
                            <span className="text-xs font-medium text-rose-600 dark:text-rose-400">
                              {r.error}
                            </span>
                          ) : (
                            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                              Ready
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {validRows.length > 0 && (
                <div className="rounded-2xl border border-line bg-surface-2/40 p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <Icon name="lock" size={15} className="text-muted" />
                    Default password for all {validRows.length} trainer
                    {validRows.length === 1 ? '' : 's'}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    Every imported account starts with this password and is asked to change it on
                    first sign-in.
                  </p>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="label" htmlFor="bulk-pw">
                        Password
                      </label>
                      <div className="relative">
                        <input
                          id="bulk-pw"
                          type={showPw ? 'text' : 'password'}
                          className="input pr-11"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="At least 6 characters"
                          autoComplete="new-password"
                          aria-invalid={pwTooShort ? 'true' : undefined}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPw((s) => !s)}
                          aria-label={showPw ? 'Hide password' : 'Show password'}
                          className="focus-ring absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
                        >
                          <Icon name={showPw ? 'eyeOff' : 'eye'} size={16} />
                        </button>
                      </div>
                      {pwTooShort && (
                        <p className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">
                          Must be at least {MIN_PASSWORD} characters.
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="label" htmlFor="bulk-pw2">
                        Confirm password
                      </label>
                      <input
                        id="bulk-pw2"
                        type={showPw ? 'text' : 'password'}
                        className="input"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        placeholder="Re-enter it"
                        autoComplete="new-password"
                        aria-invalid={pwMismatch ? 'true' : undefined}
                      />
                      {pwMismatch && (
                        <p className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">
                          Passwords don’t match.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-ghost" onClick={close}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={submit} disabled={!canImport}>
              {busy ? (
                <>
                  <span
                    className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
                    style={{ animationDuration: '0.6s' }}
                    aria-hidden="true"
                  />
                  Importing…
                </>
              ) : (
                `Import ${validRows.length || ''} trainer${validRows.length === 1 ? '' : 's'}`.replace(
                  '  ',
                  ' '
                )
              )}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ResultTable({ title, rows, columns }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{title}</p>
      <div className="max-h-56 overflow-auto rounded-xl ring-1 ring-inset ring-line">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-2">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className="th !py-2">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-line/60">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`td !py-2 ${c.numeric ? 'tnum text-muted' : ''} ${
                      c.tone === 'error' ? 'text-rose-600 dark:text-rose-400' : ''
                    }`}
                  >
                    {r[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryTile({ label, value, icon, tone }) {
  const tones = {
    brand: 'bg-brand-500/12 text-brand-600 dark:text-brand-400',
    emerald: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
    amber: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
  };
  return (
    <div className="rounded-2xl border border-line bg-surface-2/40 p-3.5">
      <span className={`grid h-8 w-8 place-items-center rounded-lg ${tones[tone]}`}>
        <Icon name={icon} size={15} />
      </span>
      <p className="mt-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className="tnum text-display-sm text-ink">{value}</p>
    </div>
  );
}
