'use client';

import { Button } from '@/components/ui/Button';
import { FieldLabel, Input, Textarea } from '@/components/ui/FormFields';
import { PhotoGridField } from '@/components/photos/PhotoField';
import { normalizePhotoMetadataMap, type PhotoMetadataMap } from '@/lib/photoMetadata';
import type { AuditWriteGuard } from '@/types/domain';

export type EquipmentCustomField = {
  id: string;
  question: string;
  answer: string;
  photos: string[];
  photoDescs: PhotoMetadataMap;
};

function customFieldId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeEquipmentCustomFields(value: unknown): EquipmentCustomField[] {
  let source: unknown = value;
  if (typeof source === 'string') {
    try { source = JSON.parse(source); } catch { source = []; }
  }
  if (!Array.isArray(source)) return [];
  return source.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    return [{
      id: typeof record.id === 'string' && record.id ? record.id : `custom-${index + 1}`,
      question: typeof record.question === 'string' ? record.question : '',
      answer: typeof record.answer === 'string' ? record.answer : '',
      photos: Array.isArray(record.photos) ? record.photos.filter((photo): photo is string => typeof photo === 'string') : [],
      photoDescs: normalizePhotoMetadataMap(record.photoDescs ?? record.photo_descs),
    }];
  });
}

export function CustomFieldsEditor({
  value,
  onChange,
  auditId,
  entityId,
  entityType,
  disabled,
  guard,
}: {
  value: unknown;
  onChange: (value: EquipmentCustomField[]) => void;
  auditId: string;
  entityId?: string;
  entityType?: string;
  disabled?: boolean;
  guard: AuditWriteGuard;
}) {
  const fields = normalizeEquipmentCustomFields(value);

  function update(index: number, patch: Partial<EquipmentCustomField>) {
    onChange(fields.map((field, itemIndex) => itemIndex === index ? { ...field, ...patch } : field));
  }

  return (
    <div className="space-y-4 md:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-[var(--text)]">Custom Questions</p>
          <p className="mt-1 text-xs text-[var(--text-sub)]">Add site-specific questions, answers, and supporting photos.</p>
        </div>
        {!disabled ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => onChange([...fields, { id: customFieldId(), question: '', answer: '', photos: [], photoDescs: {} }])}
          >
            Add custom question
          </Button>
        ) : null}
      </div>

      {fields.map((field, index) => (
        <section key={field.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-bold text-[var(--text)]">Custom Question {index + 1}</p>
            {!disabled ? (
              <Button type="button" variant="ghost" onClick={() => onChange(fields.filter((_, itemIndex) => itemIndex !== index))}>
                Remove
              </Button>
            ) : null}
          </div>
          <FieldLabel>Question</FieldLabel>
          <Input value={field.question} disabled={disabled} onChange={(event) => update(index, { question: event.target.value })} />
          <FieldLabel>Answer</FieldLabel>
          <Textarea value={field.answer} disabled={disabled} onChange={(event) => update(index, { answer: event.target.value })} />
          <div className="mt-4">
            <PhotoGridField
              label="Supporting Photos"
              uris={field.photos}
              auditId={auditId}
              entityId={entityId}
              entityType={entityType}
              fieldPrefix="photos"
              uploadFieldPrefix={`customFields.${field.id}.photos`}
              onChange={(photos) => update(index, { photos })}
              photoMetadata={field.photoDescs}
              onPhotoMetadataChange={(photoDescs) => update(index, { photoDescs })}
              disabled={disabled}
              guard={guard}
            />
          </div>
        </section>
      ))}
    </div>
  );
}
