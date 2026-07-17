import { AlertTriangle, X } from 'lucide-react';
import { type ReactNode } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <header className="dialog-header">
          <div className={`dialog-icon ${destructive ? 'danger' : ''}`}>
            <AlertTriangle aria-hidden="true" />
          </div>
          <div>
            <h2 id="confirm-title">{title}</h2>
            <div className="dialog-description">{description}</div>
          </div>
          <button className="icon-button" type="button" aria-label="Close dialog" onClick={onCancel}>
            <X aria-hidden="true" />
          </button>
        </header>
        <footer className="dialog-actions">
          <button className="button secondary" type="button" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            className={`button ${destructive ? 'danger' : 'primary'}`}
            type="button"
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}

