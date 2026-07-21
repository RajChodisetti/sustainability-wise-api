import type { ExportJobStatus as ExportJob } from '@/types/domain';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';

export function ExportJobStatus({
  job,
  artifactName,
  starting = false,
  downloading = false,
  onDownload,
  className = '',
}: {
  job: ExportJob | null;
  artifactName: string;
  starting?: boolean;
  downloading?: boolean;
  onDownload: () => void;
  className?: string;
}) {
  if (!job && !starting) return null;

  const status = job?.status ?? 'queued';
  const active = status === 'queued' || status === 'running';
  const complete = status === 'complete';
  const failed = status === 'failed';
  const progress = job?.progressTotal
    ? Math.min(100, Math.round(((job.progressCurrent ?? 0) / job.progressTotal) * 100))
    : null;
  const tone = failed
    ? 'border-[var(--red)]/30 bg-[var(--red-soft)]'
    : complete
      ? 'border-[var(--green)]/30 bg-[var(--green-soft)]'
      : 'border-[var(--primary)]/25 bg-[var(--primary-soft)]';
  const iconTone = failed
    ? 'text-[var(--red)]'
    : complete
      ? 'text-[var(--green)]'
      : 'text-[var(--primary)]';

  return (
    <div
      className={`rounded-[var(--radius-sm)] border px-4 py-4 ${tone} ${className}`}
      role={failed ? 'alert' : 'status'}
      aria-live={failed ? 'assertive' : 'polite'}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {active ? (
            <span className={`mt-0.5 inline-block h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent ${iconTone}`} aria-hidden />
          ) : (
            <Icon name={complete ? 'check' : 'activity'} size={21} className={`mt-0.5 shrink-0 ${iconTone}`} />
          )}
          <div className="min-w-0">
            <p className="font-extrabold text-[var(--text)]">
              {failed
                ? `${artifactName} could not be created`
                : complete
                  ? `${artifactName} is ready`
                  : `Preparing ${artifactName}`}
            </p>
            {active ? (
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--text-sub)]">
                You can leave this page. We will keep preparing it and show the download button here when it is ready.
              </p>
            ) : null}
            {complete ? (
              <p className="mt-1 text-sm leading-6 text-[var(--text-sub)]">
                The file remains available here when you return to this page.
              </p>
            ) : null}
            {failed ? (
              <p className="mt-1 text-sm leading-6 text-[var(--red)]">
                {job?.error || 'Please start the export again.'}
              </p>
            ) : null}
            {active && job?.phase ? (
              <p className="mt-2 text-xs font-bold text-[var(--primary)]">{job.phase}</p>
            ) : null}
          </div>
        </div>
        {complete ? (
          <Button className="w-full shrink-0 sm:w-auto" onClick={onDownload} disabled={downloading} aria-busy={downloading}>
            {downloading ? (
              <>
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
                Downloading...
              </>
            ) : (
              <><Icon name="file-text" size={17} />Download {artifactName}</>
            )}
          </Button>
        ) : null}
      </div>
      {active && progress !== null ? (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--surface)]" aria-label={`${progress}% complete`} role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-200" style={{ width: `${progress}%` }} />
        </div>
      ) : null}
    </div>
  );
}
