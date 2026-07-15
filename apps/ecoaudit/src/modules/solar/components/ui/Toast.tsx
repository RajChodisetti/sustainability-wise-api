import { useToast } from '@/contexts/ToastContext';

const styles: Record<string, string> = {
  success: 'border-[var(--green)]/40 bg-[var(--green)]/10 text-[var(--green)]',
  error: 'border-[var(--red)]/40 bg-[var(--red)]/10 text-[var(--red)]',
  info: 'border-[var(--primary)]/40 bg-[var(--primary)]/10 text-[var(--text)]',
};

export function ToastViewport() {
  const { toasts, dismiss } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex max-w-sm flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto rounded-lg border px-4 py-3 text-sm font-medium shadow-lg ${styles[toast.type]}`}
          role="status"
        >
          <div className="flex items-start justify-between gap-3">
            <span>{toast.message}</span>
            <button
              type="button"
              className="shrink-0 opacity-60 hover:opacity-100"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
