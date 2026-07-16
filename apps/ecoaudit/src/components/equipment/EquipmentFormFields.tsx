'use client';

import type { EquipmentTypeConfig, FieldDef } from '@/lib/equipmentConfig';
import { PhotoField, PhotoGridField } from '@/components/photos/PhotoField';
import { FieldLabel, Input, Textarea } from '@/components/ui/FormFields';
import {
  normalizePhotoMetadataMap,
  setPhotoMetadata,
} from '@/lib/photoMetadata';

export function EquipmentFormFields({
  config,
  values,
  onChange,
  auditId,
  entityId,
  disabled,
}: {
  config: EquipmentTypeConfig;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  auditId: string;
  entityId?: string;
  disabled?: boolean;
}) {
  const photoMetadata = normalizePhotoMetadataMap(values.photoDescs);

  function renderField(field: FieldDef) {
    const val = values[field.key];

    if (field.kind === 'photo') {
      return (
        <PhotoField
          key={field.key}
          label={field.label}
          uri={typeof val === 'string' ? val : null}
          auditId={auditId}
          entityId={entityId}
          entityType={config.entityType}
          fieldName={field.key}
          onChange={(uri) => onChange(field.key, uri)}
          photoMetadata={photoMetadata[field.key]}
          onPhotoMetadataChange={(metadata) => onChange(
            'photoDescs',
            setPhotoMetadata(photoMetadata, field.key, metadata),
          )}
          disabled={disabled}
        />
      );
    }

    if (field.kind === 'photos') {
      const uris = Array.isArray(val) ? (val as string[]) : [];
      return (
        <PhotoGridField
          key={field.key}
          label={field.label}
          uris={uris}
          auditId={auditId}
          entityId={entityId}
          entityType={config.entityType}
          fieldPrefix={field.key}
          onChange={(next) => onChange(field.key, next)}
          photoMetadata={photoMetadata}
          onPhotoMetadataChange={(metadata) => onChange('photoDescs', metadata)}
          disabled={disabled}
        />
      );
    }

    if (field.kind === 'textarea') {
      return (
        <div key={field.key}>
          <FieldLabel>{field.label}</FieldLabel>
          <Textarea value={typeof val === 'string' ? val : ''} onChange={(e) => onChange(field.key, e.target.value)} disabled={disabled} />
        </div>
      );
    }

    return (
      <div key={field.key}>
        <FieldLabel>{field.label}</FieldLabel>
        <Input
          type={field.kind === 'number' ? 'number' : 'text'}
          value={val === null || val === undefined ? '' : String(val)}
          onChange={(e) => onChange(field.key, field.kind === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)}
          disabled={disabled}
        />
      </div>
    );
  }

  const textFields = config.fields.filter((f) => f.kind !== 'photo' && f.kind !== 'photos');
  const photoFields = config.fields.filter((f) => f.kind === 'photo' || f.kind === 'photos');

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {textFields.map(renderField)}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {photoFields.map(renderField)}
      </div>
    </div>
  );
}
