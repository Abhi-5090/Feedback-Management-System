import Icon from './Icon.jsx';
import Modal from './Modal.jsx';
import { useToast } from './Toast.jsx';

/**
 * A credential shown exactly once.
 *
 * There is deliberately no endpoint that will show it again — the only
 * recovery is to issue a new one. That is the correct shape for a password,
 * and it makes this dialog the single moment it exists in readable form, so it
 * says so plainly rather than looking like an ordinary confirmation someone
 * can dismiss and come back to.
 */
export default function OneTimeSecret({ open, onClose, title, who, secret }) {
  const toast = useToast();
  if (!secret && !open) return null;

  return (
    <Modal open={open} onClose={onClose} title={title} description="Copy it now — it cannot be shown again.">
      <div className="space-y-4">
        {who && (
          <div className="rounded-xl border border-line bg-surface-2/60 p-3.5">
            <p className="text-sm font-semibold text-ink">{who.name}</p>
            <p className="mt-0.5 text-[11px] text-muted">{who.email}</p>
          </div>
        )}

        <div>
          <p className="label">One-time password</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 select-all truncate rounded-lg border border-line bg-surface-2 px-3 py-2.5 font-mono text-sm text-ink">
              {secret}
            </code>
            <button
              type="button"
              className="btn-outline shrink-0 !py-2.5 transition-transform duration-150 ease-out active:scale-[0.97]"
              onClick={() => {
                navigator.clipboard?.writeText(secret);
                toast.success('Copied');
              }}
              aria-label="Copy password"
            >
              <Icon name="copy" size={15} />
            </button>
          </div>
          <p className="hint">
            Pass it on yourself — it is never emailed from here. They must choose a new one before the
            account can do anything.
          </p>
        </div>

        <div className="flex justify-end">
          <button className="btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </Modal>
  );
}
