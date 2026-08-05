'use client';

import { useId, type ChangeEvent } from 'react';
import { PhotoThumb } from '@/components/photos/PhotoThumb';
import { Button } from '@/components/ui/Button';
import { FieldHint, FieldLabel, Input } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';

export type EvidenceItem = {
  id: string;
  uri: string;
  caption?: string | null;
};

export function evidenceActionLabel(itemCount: number, busy = false): string {
  if (busy) return 'Uploading…';
  return itemCount > 0 ? 'Add more photos' : 'Take or choose photos';
}

export function EvidenceField({
  label,
  items,
  required,
  busy,
  readOnly,
  hint,
  onFiles,
  onCaptionChange,
  onRemove,
}: {
  label: string;
  items: EvidenceItem[];
  required?: boolean;
  busy?: boolean;
  readOnly?: boolean;
  hint?: string;
  onFiles: (files: File[]) => void | Promise<void>;
  onCaptionChange?: (id: string, caption: string) => void | Promise<void>;
  onRemove?: (id: string) => void | Promise<void>;
}) {
  const inputId = useId();

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length) void onFiles(files);
  }

  return (
    <div className="mt-4">
      <FieldLabel htmlFor={inputId}>
        {label}{required ? <span className="text-[var(--red)]"> *</span> : null}
      </FieldLabel>
      {hint ? <FieldHint>{hint}</FieldHint> : !readOnly ? (
        <FieldHint>You can choose several photos now and use “Add more photos” later.</FieldHint>
      ) : null}
      {items.length ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item, index) => (
            <div key={item.id} className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface2)]">
              <PhotoThumb
                uri={item.uri}
                label={`${label} ${index + 1}`}
                app="installhub"
                className="h-44 w-full object-cover"
              />
              <div className="p-3">
                {onCaptionChange ? (
                  <Input
                    disabled={readOnly || busy}
                    aria-label={`Caption for ${label} ${index + 1}`}
                    placeholder="Add a caption or comment"
                    maxLength={120}
                    onBlur={(event) => void onCaptionChange(item.id, event.target.value)}
                    defaultValue={item.caption ?? ''}
                    className="!min-h-10"
                  />
                ) : (
                  <p className="text-xs text-[var(--text-sub)]">{item.caption || `Photo ${index + 1}`}</p>
                )}
                {!readOnly && onRemove ? (
                  <Button
                    variant="ghost"
                    className="mt-2 w-full text-[var(--red)]"
                    disabled={busy}
                    onClick={() => void onRemove(item.id)}
                  >
                    <Icon name="trash" size={16} />
                    Remove photo
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 flex min-h-24 items-center justify-center rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface2)] px-4 text-center text-sm text-[var(--text-sub)]">
          No evidence added yet.
        </div>
      )}
      {!readOnly ? (
        <label
          htmlFor={inputId}
          className="mt-3 inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-sm font-bold text-[var(--text)] shadow-[var(--shadow-xs)] transition hover:border-[var(--primary)] hover:bg-[var(--primary-soft)] hover:text-[var(--primary)]"
        >
          <Icon name="camera" size={17} />
          {evidenceActionLabel(items.length, busy)}
          <input
            id={inputId}
            className="sr-only"
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            disabled={busy}
            onChange={selectFiles}
          />
        </label>
      ) : null}
    </div>
  );
}
