import { useToast } from '@/contexts/ToastContext';
import { Icon } from '@/components/ui/Icon';

const styles: Record<string, string> = {
  success: 'border-[var(--green)]/30 bg-[var(--green-soft)] text-[var(--green)]',
  error: 'border-[var(--red)]/30 bg-[var(--red-soft)] text-[var(--red)]',
  info: 'border-[var(--primary)]/30 bg-[var(--primary-soft)] text-[var(--text)]',
};

export function ToastViewport() {
  const { toasts, dismiss } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-3 bottom-3 z-[100] flex flex-col items-stretch gap-2 sm:left-auto sm:right-4 sm:max-w-sm"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto rounded-[var(--radius-sm)] border px-4 py-3 text-sm font-semibold shadow-[var(--shadow-md)] ${styles[toast.type]}`}
          role={toast.type === 'error' ? 'alert' : 'status'}
          aria-atomic="true"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="leading-5">{toast.message}</span>
            <button
              type="button"
              className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
            >
              <Icon name="close" size={18} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
