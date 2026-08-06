'use client';

import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import type { TreeWriteState } from '@/modules/installhub/hooks/useInstallationTree';

const TREE_NAVIGATION_REQUEST = 'installhub:tree-navigation-request';

type PendingNavigation = {
  label: string;
  navigate: () => void;
  stay?: () => void;
};

export function requestTreeNavigation(navigate: () => void, label = 'the requested page'): void {
  if (typeof window === 'undefined') {
    navigate();
    return;
  }
  const event = new CustomEvent<{ navigate: () => void; label: string }>(TREE_NAVIGATION_REQUEST, {
    cancelable: true,
    detail: { navigate, label },
  });
  window.dispatchEvent(event);
  if (!event.defaultPrevented) navigate();
}

export function ChoiceGroup<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  hint?: string;
  value: T;
  options: Array<{
    value: T;
    label: string;
    description?: string;
    icon?: IconName;
  }>;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <fieldset disabled={disabled} className="mt-4">
      <legend className="text-sm font-bold text-[var(--text)]">{label}</legend>
      {hint ? <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">{hint}</p> : null}
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {options.map((option) => {
          const checked = option.value === value;
          return (
            <label
              key={option.value}
              className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 transition-colors focus-within:ring-2 focus-within:ring-[var(--primary)]/30 ${
                checked
                  ? 'border-[var(--primary)] bg-[var(--primary-soft)]'
                  : 'border-[var(--border-strong)] bg-[var(--surface)] hover:border-[var(--primary)]'
              }`}
            >
              <input
                type="radio"
                name={`choice-${id}`}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--primary)]"
              />
              {option.icon ? (
                <Icon name={option.icon} size={18} className="mt-0.5 shrink-0 text-[var(--primary)]" />
              ) : null}
              <span className="min-w-0">
                <span className="block text-sm font-extrabold text-[var(--text)]">{option.label}</span>
                {option.description ? (
                  <span className="mt-0.5 block text-xs leading-5 text-[var(--text-sub)]">{option.description}</span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function SaveStateNotice({
  state,
  onRetry,
  onDiscard,
}: {
  state: TreeWriteState;
  onRetry?: () => void;
  onDiscard?: () => void;
}) {
  const styles = {
    saved: 'border-[var(--green)]/30 bg-[var(--green-soft)] text-[var(--green)]',
    saving: 'border-[var(--primary)]/30 bg-[var(--primary-soft)] text-[var(--primary)]',
    failed: 'border-[var(--red)]/30 bg-[var(--red-soft)] text-[var(--red)]',
    conflict: 'border-[var(--amber)]/35 bg-[var(--amber-soft)] text-[var(--text)]',
  };
  const icons: Record<TreeWriteState['phase'], IconName> = {
    saved: 'check',
    saving: 'refresh',
    failed: 'activity',
    conflict: 'activity',
  };
  return (
    <div
      className={`inline-flex min-h-11 flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold ${styles[state.phase]}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <Icon name={icons[state.phase]} size={16} className={state.phase === 'saving' ? 'animate-spin' : ''} />
      <span>{state.message}</span>
      {state.phase === 'failed' && onRetry ? (
        <button type="button" className="min-h-9 rounded-lg border border-current px-3 font-extrabold hover:bg-white/40" onClick={onRetry}>
          Retry
        </button>
      ) : null}
      {(state.phase === 'failed' || state.phase === 'conflict') && onDiscard ? (
        <button type="button" className="min-h-9 rounded-lg px-3 font-extrabold underline underline-offset-2 hover:bg-white/40" onClick={onDiscard}>
          Discard
        </button>
      ) : null}
    </div>
  );
}

export type TreeAnchorNavigationIntent = {
  href: string;
  target?: string;
  download?: boolean;
  defaultPrevented?: boolean;
  button?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
};

export function guardedTreeAnchorHref(
  active: boolean,
  intent: TreeAnchorNavigationIntent,
  currentHref: string,
): string | null {
  if (
    !active
    || intent.defaultPrevented
    || (intent.button ?? 0) !== 0
    || intent.metaKey
    || intent.ctrlKey
    || intent.shiftKey
    || intent.altKey
    || intent.target === '_blank'
    || intent.download
  ) return null;
  const current = new URL(currentHref);
  const next = new URL(intent.href, current);
  if (next.origin !== current.origin || next.href === current.href) return null;
  return next.href;
}

export function deferTreeNavigationPrompt(
  schedule: (callback: () => void) => void,
  showPrompt: () => void,
): void {
  schedule(showPrompt);
}

export function TreeDraftNavigationGuard({
  active,
  onDiscard,
}: {
  active: boolean;
  onDiscard: () => void | Promise<void>;
}) {
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const [busy, setBusy] = useState(false);
  const bypassRef = useRef(false);
  const activeRef = useRef(active);
  useLayoutEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const navigation = (window as Window & {
      navigation?: {
        addEventListener: (name: 'navigate', listener: (event: Event) => void) => void;
        removeEventListener: (name: 'navigate', listener: (event: Event) => void) => void;
      };
    }).navigation;
    const requestNavigation = (event: Event) => {
      if (!activeRef.current || bypassRef.current) return;
      const request = event as CustomEvent<{ navigate: () => void; label: string }>;
      event.preventDefault();
      setPendingNavigation({
        label: request.detail.label,
        navigate: request.detail.navigate,
      });
    };
    window.addEventListener(TREE_NAVIGATION_REQUEST, requestNavigation);

    const guardLink = (event: MouseEvent) => {
      if (bypassRef.current) return;
      const element = event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>('a[href]')
        : null;
      if (!element) return;
      const guardedHref = guardedTreeAnchorHref(
        activeRef.current,
        {
          href: element.href,
          target: element.target,
          download: element.hasAttribute('download'),
          defaultPrevented: event.defaultPrevented,
          button: event.button,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
        },
        window.location.href,
      );
      if (!guardedHref) return;
      event.preventDefault();
      event.stopPropagation();
      setPendingNavigation({
        label: new URL(guardedHref).pathname,
        navigate: () => element.click(),
      });
    };
    document.addEventListener('click', guardLink, true);

    let guardNavigation: ((event: Event) => void) | null = null;
    if (navigation) {
      guardNavigation = (event: Event) => {
        if (!activeRef.current || bypassRef.current) return;
        const navigationEvent = event as Event & {
          canIntercept?: boolean;
          downloadRequest?: string | null;
          hashChange?: boolean;
          navigationType?: string;
          destination?: { url?: string };
          intercept?: (options: { handler: () => Promise<void> }) => void;
        };
        if (
          !navigationEvent.canIntercept
          || navigationEvent.downloadRequest
          || navigationEvent.hashChange
          || navigationEvent.navigationType === 'reload'
          || !navigationEvent.intercept
        ) return;
        navigationEvent.intercept({
          handler: () => new Promise<void>((resolve, reject) => {
            deferTreeNavigationPrompt(
              (showPrompt) => { window.setTimeout(showPrompt, 0); },
              () => {
                setPendingNavigation({
                  label: navigationEvent.destination?.url || 'the requested page',
                  navigate: resolve,
                  stay: () => reject(new DOMException('Navigation cancelled by user.', 'AbortError')),
                });
              },
            );
          }),
        });
      };
      navigation.addEventListener('navigate', guardNavigation);
    }

    return () => {
      window.removeEventListener(TREE_NAVIGATION_REQUEST, requestNavigation);
      document.removeEventListener('click', guardLink, true);
      if (navigation && guardNavigation) {
        navigation.removeEventListener('navigate', guardNavigation);
      }
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const navigation = (window as Window & { navigation?: unknown }).navigation;
    if (navigation) return;
    const marker = `installhub-guard-${Date.now()}-${Math.random()}`;
    window.history.pushState({ ...window.history.state, __installhubGuard: marker }, '', window.location.href);
    let restoringMarker = false;
    const guardBack = () => {
      if (bypassRef.current) return;
      if (restoringMarker) {
        restoringMarker = false;
        return;
      }
      setPendingNavigation({
        label: 'the previous page',
        navigate: () => window.history.go(-2),
      });
      restoringMarker = true;
      window.history.forward();
    };
    window.addEventListener('popstate', guardBack);
    return () => {
      window.removeEventListener('popstate', guardBack);
      if (!bypassRef.current && window.history.state?.__installhubGuard === marker) {
        window.history.back();
      }
    };
  }, [active]);

  async function discardAndLeave() {
    if (!pendingNavigation) return;
    setBusy(true);
    try {
      bypassRef.current = true;
      await onDiscard();
      pendingNavigation.navigate();
    } finally {
      setBusy(false);
    }
  }

  function stay() {
    pendingNavigation?.stay?.();
    setPendingNavigation(null);
  }

  return (
    <ConfirmDialog
      open={active && Boolean(pendingNavigation)}
      title="Leave with unsent fields?"
      description="This tab contains changes that the server has not confirmed. Staying keeps them available for retry."
      consequences={['Discard removes the tab-scoped recovery copy.', 'The next screen will show only server-confirmed data.']}
      confirmLabel="Discard and leave"
      cancelLabel="Stay"
      busy={busy}
      onConfirm={() => void discardAndLeave()}
      onCancel={stay}
    />
  );
}

export function ErrorSummary({
  title = 'Check the following items',
  errors,
}: {
  title?: string;
  errors: Array<{ id?: string; message: string }>;
}) {
  const summaryRef = useRef<HTMLDivElement>(null);
  const priorSignatureRef = useRef('');
  const errorSignature = errors.map((error) => `${error.id || ''}:${error.message}`).join('|');

  useEffect(() => {
    if (!errors.length || priorSignatureRef.current === errorSignature) return;
    priorSignatureRef.current = errorSignature;
    const timeout = window.setTimeout(() => summaryRef.current?.focus(), 0);
    return () => window.clearTimeout(timeout);
  }, [errorSignature, errors.length]);

  if (!errors.length) return null;
  return (
    <div
      ref={summaryRef}
      className="mb-5 rounded-xl border border-[var(--red)]/30 bg-[var(--red-soft)] p-4 text-sm text-[var(--red)]"
      role="alert"
      tabIndex={-1}
    >
      <p className="font-extrabold">{title}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {errors.map((error, index) => (
          <li key={`${error.id || 'error'}-${index}`}>
            {error.id ? (
              <a
                href={`#${error.id}`}
                className="font-semibold underline underline-offset-2"
                onClick={(event) => {
                  event.preventDefault();
                  focusWorkflowErrorTarget(error.id!);
                }}
              >
                {error.message}
              </a>
            ) : error.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function focusWorkflowErrorTarget(
  targetId: string,
  root?: Pick<Document, 'getElementById'>,
): boolean {
  const documentRoot = root ?? (typeof document === 'undefined' ? undefined : document);
  const target = documentRoot?.getElementById(targetId);
  if (!target) return false;
  const naturallyFocusable = target.matches(
    'button, a[href], input, select, textarea, [contenteditable="true"], [tabindex]',
  );
  if (!naturallyFocusable) {
    target.setAttribute('tabindex', '-1');
    target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
  }
  target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  target.focus({ preventScroll: true });
  return true;
}

export function ConfirmDialog({
  open,
  title,
  description,
  consequences = [],
  confirmLabel,
  cancelLabel = 'Cancel',
  danger = true,
  busy = false,
  blockedMessage,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  consequences?: string[];
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  blockedMessage?: string;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const cancelFromDialogEffect = useEffectEvent(() => {
    if (!busy) onCancel();
  });

  useEffect(() => {
    if (!open) return;
    const prior = document.activeElement as HTMLElement | null;
    const focusTimer = window.setTimeout(() => {
      if (dialogRef.current?.contains(document.activeElement)) return;
      summaryRef.current?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelFromDialogEffect();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown);
      prior?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/65 p-4" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel();
    }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xl sm:p-6"
      >
        <h2 id={titleId} className="text-xl font-extrabold text-[var(--text)]">{title}</h2>
        <div
          ref={summaryRef}
          id={descriptionId}
          tabIndex={-1}
          className="mt-3 rounded-xl border border-[var(--amber)]/35 bg-[var(--amber-soft)] p-4 outline-none focus:ring-2 focus:ring-[var(--primary)]"
        >
          {description ? <p className="text-sm leading-6 text-[var(--text)]">{description}</p> : null}
          {consequences.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-[var(--text)]">
              {consequences.map((item) => <li key={item}>{item}</li>)}
            </ul>
          ) : null}
          {blockedMessage ? <p className="mt-2 text-sm font-bold text-[var(--red)]">{blockedMessage}</p> : null}
        </div>
        {children ? <div className="mt-4">{children}</div> : null}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy || Boolean(blockedMessage)}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
