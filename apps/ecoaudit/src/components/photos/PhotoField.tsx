'use client';

import { useId } from 'react';
import { Button } from '@/components/ui/Button';
import { Checkbox, FieldError, FieldHint, FieldLabel, Input } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { PhotoThumb } from '@/components/photos/PhotoThumb';
import { useToast } from '@/contexts/ToastContext';
import { usePhotoUpload } from '@/hooks/usePhotoUpload';
import {
  normalizePhotoMetadata,
  photoMetadataKey,
  photoUploadFieldName,
  removePhotoMetadataIndex,
  setPhotoMetadata,
  type PhotoMetadataMap,
  type PhotoMetadataValue,
} from '@/lib/photoMetadata';

export function PhotoField({
  label,
  uri,
  auditId,
  entityId,
  entityType,
  fieldName,
  onChange,
  photoMetadata,
  onPhotoMetadataChange,
  disabled,
}: {
  label: string;
  uri?: string | null;
  auditId: string;
  entityId?: string;
  entityType?: string;
  fieldName: string;
  onChange: (uri: string | null) => void;
  photoMetadata?: PhotoMetadataValue;
  onPhotoMetadataChange?: (metadata: PhotoMetadataValue) => void;
  disabled?: boolean;
}) {
  const { upload, uploading, error } = usePhotoUpload();
  const toast = useToast();
  const inputId = useId();
  const captionId = `${inputId}-caption`;
  const metadata = normalizePhotoMetadata(photoMetadata);

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
        <div className="mb-3 space-y-3">
          <PhotoThumb key={uri} uri={uri} label={metadata.name?.trim() || label} className="mb-0 max-h-48 w-full rounded-lg border border-[var(--border)] object-cover" />
          {onPhotoMetadataChange ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface2)] p-3">
              <FieldLabel htmlFor={captionId} className="!mt-0">Photo name / caption in PDF</FieldLabel>
              <Input
                id={captionId}
                value={metadata.name ?? ''}
                maxLength={120}
                placeholder={label}
                disabled={disabled}
                onChange={(event) => onPhotoMetadataChange({ ...metadata, name: event.target.value })}
              />
              <Checkbox
                label="Use large photo in PDF"
                checked={metadata.largeInPdf === true}
                disabled={disabled}
                onChange={(largeInPdf) => onPhotoMetadataChange({ ...metadata, largeInPdf })}
              />
              <FieldHint>Off uses the smaller multi-photo grid.</FieldHint>
            </div>
          ) : null}
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
          <Button
            variant="ghost"
            aria-label={`Remove ${label}`}
            onClick={() => {
              onChange(null);
              onPhotoMetadataChange?.({});
            }}
          >
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
  auditId,
  entityId,
  entityType,
  fieldPrefix,
  onChange,
  photoMetadata = {},
  onPhotoMetadataChange,
  disabled,
}: {
  label: string;
  uris: string[];
  auditId: string;
  entityId?: string;
  entityType?: string;
  fieldPrefix: string;
  onChange: (uris: string[]) => void;
  photoMetadata?: PhotoMetadataMap;
  onPhotoMetadataChange?: (metadata: PhotoMetadataMap) => void;
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
      fieldName: photoUploadFieldName(fieldPrefix, uris.length),
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

  function handleRemove(index: number) {
    const nextUris = uris.filter((_, itemIndex) => itemIndex !== index);
    onChange(nextUris);
    onPhotoMetadataChange?.(
      removePhotoMetadataIndex(photoMetadata, fieldPrefix, index, nextUris.length),
    );
  }

  return (
    <div>
      <p className="mb-3 text-sm font-bold text-[var(--text)]">{label}</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy={uploading}>
        {uris.map((uri, i) => (
          <div key={`${uri}-${i}`} className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface2)]">
            <div className="relative">
              <PhotoThumb
                uri={uri}
                label={normalizePhotoMetadata(photoMetadata[photoMetadataKey(fieldPrefix, i)]).name?.trim() || `${label} ${i + 1}`}
                className="aspect-square w-full object-cover"
              />
              {!disabled ? (
                <button
                  type="button"
                  className="absolute right-1.5 top-1.5 flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg bg-black/65 text-white shadow-lg transition-colors duration-200 hover:bg-black/80 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
                  onClick={() => handleRemove(i)}
                  aria-label={`Remove ${label} photo ${i + 1}`}
                >
                  <Icon name="close" size={18} />
                </button>
              ) : null}
            </div>
            {onPhotoMetadataChange ? (
              <PhotoMetadataControls
                id={`${inputId}-photo-${i}`}
                defaultLabel={`${label} ${i + 1}`}
                value={photoMetadata[photoMetadataKey(fieldPrefix, i)]}
                disabled={disabled}
                onChange={(value) => onPhotoMetadataChange(
                  setPhotoMetadata(photoMetadata, photoMetadataKey(fieldPrefix, i), value),
                )}
              />
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

export function PhotoMetadataControls({
  id,
  defaultLabel,
  value,
  disabled,
  onChange,
}: {
  id: string;
  defaultLabel: string;
  value: PhotoMetadataValue;
  disabled?: boolean;
  onChange: (value: PhotoMetadataValue) => void;
}) {
  const metadata = normalizePhotoMetadata(value);
  return (
    <div className="space-y-1 border-t border-[var(--border)] p-3">
      <FieldLabel htmlFor={id} className="!mt-0">Photo name / caption in PDF</FieldLabel>
      <Input
        id={id}
        value={metadata.name ?? ''}
        maxLength={120}
        placeholder={defaultLabel}
        disabled={disabled}
        onChange={(event) => onChange({ ...metadata, name: event.target.value })}
      />
      <Checkbox
        label="Use large photo in PDF"
        checked={metadata.largeInPdf === true}
        disabled={disabled}
        onChange={(largeInPdf) => onChange({ ...metadata, largeInPdf })}
      />
      <FieldHint>Off uses the smaller multi-photo grid.</FieldHint>
    </div>
  );
}
