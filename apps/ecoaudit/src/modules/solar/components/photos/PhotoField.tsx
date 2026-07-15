import { useId } from 'react';
import { PhotoThumb } from '@/components/photos/PhotoThumb';
import { Button } from '@solar/components/ui/Button';
import { FieldError } from '@solar/components/ui/FormFields';
import { useToast } from '@/contexts/ToastContext';
import { usePhotoUpload } from '@solar/hooks/usePhotoUpload';
import { Icon } from '@/components/ui/Icon';

export function PhotoField({
  label,
  uri,
  siteId,
  assessmentId,
  fieldName,
  onChange,
  disabled,
}: {
  label: string;
  uri?: string | null;
  siteId: string;
  assessmentId?: string;
  fieldName: string;
  onChange: (uri: string | null) => void;
  disabled?: boolean;
}) {
  const { upload, uploading, error } = usePhotoUpload();
  const toast = useToast();
  const inputId = useId();

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const result = await upload({ file, siteId, assessmentId, fieldName });
    if (result.url) {
      onChange(result.url);
      toast.success(`${label} uploaded successfully.`);
    } else if (result.error) {
      toast.error(result.error);
    }
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-xs)]">
      <p className="mb-3 text-sm font-bold text-[var(--text)]">{label}</p>
      {uri ? (
        <PhotoThumb
          key={uri}
          app="solarsense"
          uri={uri}
          label={label}
          className="mb-2 max-h-48 w-full rounded-lg object-cover"
        />
      ) : (
        <div className="mb-3 flex h-32 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface2)] text-sm text-[var(--muted)]">
          <Icon name="camera" size={24} />
          No photo
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <label htmlFor={inputId} className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] bg-[var(--primary)] px-4 text-sm font-bold text-[var(--primary-fg)] shadow-[var(--shadow-xs)] focus-within:outline focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-[var(--focus)] hover:bg-[var(--primary-hover)] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
          <input
            id={inputId}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            aria-label={`${uri ? 'Replace' : 'Upload'} ${label}`}
            disabled={disabled || uploading}
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
          <span className="inline-flex items-center gap-2">
            <Icon name="camera" size={17} />
            {uploading ? 'Uploading…' : uri ? 'Replace' : 'Upload'}
          </span>
        </label>
        {uri ? (
          <Button variant="ghost" aria-label={`Remove ${label}`} onClick={() => onChange(null)} disabled={disabled}>
            Remove
          </Button>
        ) : null}
      </div>
      <FieldError message={error ?? undefined} />
    </div>
  );
}

export function PhotoGridField({
  label,
  uris,
  siteId,
  assessmentId,
  fieldPrefix,
  onChange,
  disabled,
}: {
  label: string;
  uris: string[];
  siteId: string;
  assessmentId?: string;
  fieldPrefix: string;
  onChange: (uris: string[]) => void;
  disabled?: boolean;
}) {
  const { upload, uploading, error } = usePhotoUpload();
  const toast = useToast();
  const inputId = useId();

  async function handleAdd(file: File | undefined) {
    if (!file) return;
    const result = await upload({
      file,
      siteId,
      assessmentId,
      fieldName: `${fieldPrefix}_${uris.length}`,
    });
    if (result.url) {
      onChange([...uris, result.url]);
      toast.success('Photo uploaded successfully.');
    } else if (result.error) {
      toast.error(result.error);
    }
  }

  return (
    <div>
      <p className="mb-3 text-sm font-bold text-[var(--text)]">{label}</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3" aria-busy={uploading}>
        {uris.map((uri, i) => {
          return (
            <div key={`${uri}-${i}`} className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface2)]">
              <PhotoThumb
                app="solarsense"
                uri={uri}
                label={`${label} ${i + 1}`}
                className="aspect-square w-full object-cover"
              />
              {!disabled ? (
                <button
                  type="button"
                  className="absolute right-1.5 top-1.5 flex h-11 w-11 items-center justify-center rounded-lg bg-black/65 text-white shadow-lg hover:bg-black/80"
                  onClick={() => onChange(uris.filter((_, idx) => idx !== i))}
                  aria-label={`Remove ${label} photo ${i + 1}`}
                >
                  <Icon name="close" size={18} />
                </button>
              ) : null}
            </div>
          );
        })}
        {!disabled ? (
          <label htmlFor={inputId} className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface2)] p-3 text-center text-xs font-bold text-[var(--text-sub)] focus-within:outline focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-[var(--focus)] hover:border-[var(--primary)] hover:text-[var(--primary)]">
            <input
              id={inputId}
              type="file"
              accept="image/*"
              className="sr-only"
              aria-label={`Add photo to ${label}`}
              disabled={uploading}
              onChange={(e) => void handleAdd(e.target.files?.[0])}
            />
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface)] shadow-[var(--shadow-xs)]"><Icon name="plus" size={20} /></span>
            {uploading ? 'Uploading…' : 'Add photo'}
          </label>
        ) : null}
      </div>
      <FieldError message={error ?? undefined} />
    </div>
  );
}
