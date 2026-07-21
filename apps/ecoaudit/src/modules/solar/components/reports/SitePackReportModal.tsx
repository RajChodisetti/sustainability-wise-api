import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { RooftopAssessment } from '@solar/types/domain';
import {
  buildSitePackInventory,
  countIncludedPhotos,
  createDefaultReportOptions,
  type SitePackReportOptions,
} from '@solar/lib/reportConfig';
import { Button } from '@solar/components/ui/Button';
import { Icon } from '@/components/ui/Icon';

export function SitePackReportModal({
  open,
  siteName,
  assessments,
  onClose,
  onGenerate,
  busy,
}: {
  open: boolean;
  siteName: string;
  assessments: RooftopAssessment[];
  onClose: () => void;
  onGenerate: (options: SitePackReportOptions, assessmentIds: string[]) => void;
  busy?: boolean;
}) {
  const [options, setOptions] = useState(() => createDefaultReportOptions(assessments));
  const inventory = useMemo(() => buildSitePackInventory(assessments), [assessments]);
  const photoCount = countIncludedPhotos(options, inventory);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
    busyRef.current = busy;
  }, [onClose, busy]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;

  function toggleAssessment(id: string) {
    const next = new Set(options.includedAssessmentIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOptions({ ...options, includedAssessmentIds: next });
  }

  function togglePhoto(uri: string) {
    const next = new Set(options.includedPhotoUris);
    if (next.has(uri)) next.delete(uri);
    else next.add(uri);
    setOptions({ ...options, includedPhotoUris: next });
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-[var(--overlay)] p-0 sm:items-center sm:p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-md)] sm:max-h-[90vh] sm:rounded-[var(--radius-lg)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4 sm:px-6 sm:py-5">
          <div>
            <h2 id={titleId} className="text-xl font-extrabold tracking-[-0.025em] text-[var(--text)]">Generate Site Pack PDF</h2>
            <p className="mt-1 text-sm text-[var(--text-sub)]">{siteName}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--text-sub)] hover:bg-[var(--surface2)] hover:text-[var(--text)] disabled:opacity-50"
            aria-label="Close PDF options"
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        <div className="subtle-scrollbar flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-6">
          <section aria-labelledby={`${titleId}-buildings`}>
            <h3 id={`${titleId}-buildings`} className="text-sm font-extrabold text-[var(--text)]">Buildings</h3>
            <div className="mt-2 space-y-2">
              {assessments.map((a) => (
                <label key={a.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium hover:bg-[var(--surface2)]">
                  <input
                    type="checkbox"
                    checked={options.includedAssessmentIds.has(a.id)}
                    onChange={() => toggleAssessment(a.id)}
                    className="h-5 w-5 shrink-0 accent-[var(--primary)]"
                  />
                  {a.buildingIdName}
                </label>
              ))}
            </div>
          </section>

          <section aria-labelledby={`${titleId}-photos`}>
            <div className="flex items-center justify-between gap-3">
              <h3 id={`${titleId}-photos`} className="text-sm font-extrabold text-[var(--text)]">Photos</h3>
              <span className="rounded-full bg-[var(--primary-soft)] px-2.5 py-1 text-xs font-bold text-[var(--primary)]">{photoCount} selected</span>
            </div>
            <div className="subtle-scrollbar mt-2 max-h-56 space-y-2 overflow-auto rounded-xl border border-[var(--border)] p-2">
              {inventory
                .filter((g) => options.includedAssessmentIds.has(g.assessmentId))
                .flatMap((g) => g.photos.map((p) => ({ ...p, buildingName: g.buildingName })))
                .map((p) => (
                  <label key={p.uri} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--surface2)]">
                    <input
                      type="checkbox"
                      checked={options.includedPhotoUris.has(p.uri)}
                      onChange={() => togglePhoto(p.uri)}
                      className="h-5 w-5 shrink-0 accent-[var(--primary)]"
                    />
                    <span className="truncate">{p.buildingName} — {p.label}</span>
                  </label>
                ))}
            </div>
          </section>

          <section className="space-y-1 rounded-xl border border-[var(--border)] p-3" aria-label="Report sections">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm font-medium hover:bg-[var(--surface2)]">
              <input
                type="checkbox"
                checked={options.includeRagFramework}
                onChange={(e) => setOptions({ ...options, includeRagFramework: e.target.checked })}
                className="h-5 w-5 accent-[var(--primary)]"
              />
              Include RAG framework
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm font-medium hover:bg-[var(--surface2)]">
              <input
                type="checkbox"
                checked={options.includeAppendix}
                onChange={(e) => setOptions({ ...options, includeAppendix: e.target.checked })}
                className="h-5 w-5 accent-[var(--primary)]"
              />
              Include appendix
            </label>
          </section>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            onClick={() =>
              onGenerate(
                options,
                assessments.filter((a) => options.includedAssessmentIds.has(a.id)).map((a) => a.id),
              )
            }
            disabled={busy || options.includedAssessmentIds.size === 0}
          >
            {busy ? 'Starting...' : 'Generate PDF'}
          </Button>
        </div>
      </div>
    </div>
  );
}
