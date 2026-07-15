'use client';

import { useId } from 'react';
import { Button } from '@/components/ui/Button';
import { FieldError } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { PhotoThumb } from '@/components/photos/PhotoThumb';
import { useToast } from '@/contexts/ToastContext';
import { usePhotoUpload } from '@/hooks/usePhotoUpload';

export function PhotoField({
  label,
  uri,
  auditId,
  entityId,
  entityType,
  fieldName,
  onChange,
  disabled,
}: {
  label: string;
  uri?: string | null;
  auditId: string;
  entityId?: string;
  entityType?: string;
  fieldName: string;
  onChange: (uri: string | null) => void;
  disabled?: boolean;
}) {
  const { upload, uploading, error } = usePhotoUpload();
  const toast = useToast();
  const inputId = useId();

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const result = await upload({ file, auditId, fieldName, entityId, entityType });
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
        <div className="mb-2">
          <PhotoThumb key={uri} uri={uri} label={label} className="mb-0 max-h-48 w-full rounded-lg object-cover" />
        </div>
      ) : (
        <div className="mb-3 flex h-32 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface2)] text-sm text-[var(--muted)]">
          <Icon name="camera" size={24} />
          No photo
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <label
          htmlFor={inputId}
          className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] bg-[var(--primary)] px-4 text-sm font-bold text-[var(--primary-fg)] shadow-[var(--shadow-xs)] focus-within:outline focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-[var(--focus)] hover:bg-[var(--primary-hover)] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
        >
          <input id={inputId} type="file" accept="image/*" className="sr-only" aria-label={`${uri ? 'Replace' : 'Upload'} ${label}`} disabled={disabled || uploading} onChange={(e) => void handleFile(e.target.files?.[0])} />
          <span className="inline-flex items-center gap-2">
            <Icon name="camera" size={17} />
            {uploading ? 'Uploading…' : uri ? 'Replace' : 'Upload'}
          </span>
        </label>
        {uri && !disabled ? (
          <Button variant="ghost" aria-label={`Remove ${label}`} onClick={() => onChange(null)}>Remove</Button>
        ) : null}
      </div>
      <FieldError message={error ?? undefined} />
    </div>
  );
}

export function PhotoGridField({
  label,
  uris,
  auditId,
  entityId,
  entityType,
  fieldPrefix,
  onChange,
  disabled,
}: {
  label: string;
  uris: string[];
  auditId: string;
  entityId?: string;
  entityType?: string;
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
      auditId,
      fieldName: `${fieldPrefix}_${uris.length}`,
      entityId,
      entityType,
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
        {uris.map((uri, i) => (
          <div key={`${uri}-${i}`} className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface2)]">
            <PhotoThumb uri={uri} label={label} className="aspect-square w-full object-cover" />
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
        ))}
        {!disabled ? (
          <label htmlFor={inputId} className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface2)] p-3 text-center text-xs font-bold text-[var(--text-sub)] focus-within:outline focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-[var(--focus)] hover:border-[var(--primary)] hover:text-[var(--primary)]">
            <input id={inputId} type="file" accept="image/*" className="sr-only" aria-label={`Add photo to ${label}`} disabled={uploading} onChange={(e) => void handleAdd(e.target.files?.[0])} />
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface)] shadow-[var(--shadow-xs)]"><Icon name="plus" size={20} /></span>
            {uploading ? 'Uploading…' : 'Add photo'}
          </label>
        ) : null}
      </div>
      <FieldError message={error ?? undefined} />
    </div>
  );
}
