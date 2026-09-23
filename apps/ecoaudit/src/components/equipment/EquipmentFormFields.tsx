'use client';

import type { EquipmentTypeConfig, FieldDef } from '@/lib/equipmentConfig';
import { PhotoField, PhotoGridField } from '@/components/photos/PhotoField';
import { CustomFieldsEditor } from '@/components/equipment/CustomFieldsEditor';
import { FieldHint, FieldLabel, Input, Select, Textarea } from '@/components/ui/FormFields';
import {
  normalizePhotoDescsRecord,
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
  const photoMetadata = normalizePhotoDescsRecord(values);

  function calculatedValue(field: FieldDef): number | null {
    const calculation = field.calculation;
    if (!calculation) return null;
    const first = Number(values[calculation.operands[0]]);
    if (!Number.isFinite(first)) return null;
    let result: number;
    if (calculation.operation === 'divide') {
      const second = Number(values[calculation.operands[1] ?? '']);
      if (!Number.isFinite(second) || second === 0) return null;
      result = first / second;
    } else {
      const secondKey = calculation.operands[1];
      const second = secondKey ? Number(values[secondKey]) : calculation.factor ?? 1;
      if (!Number.isFinite(second)) return null;
      result = first * second * (secondKey ? calculation.factor ?? 1 : 1);
    }
    return Number(result.toFixed(calculation.decimalPlaces ?? 2));
  }

  function isVisible(field: FieldDef): boolean {
    return !field.condition || field.condition.values.includes(String(values[field.condition.key] ?? ''));
  }

  function renderField(field: FieldDef) {
    const val = values[field.key];

    if (field.kind === 'customFields') {
      return (
        <CustomFieldsEditor
          key={field.key}
          value={val}
          onChange={(next) => onChange(field.key, next)}
          auditId={auditId}
          entityId={entityId}
          entityType={config.entityType}
          disabled={disabled}
        />
      );
    }

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
            normalizePhotoMetadataMap(setPhotoMetadata(photoMetadata, field.key, metadata)),
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
          <FieldLabel>{field.label}{field.required ? ' *' : ''}</FieldLabel>
          <Textarea required={field.required} value={typeof val === 'string' ? val : ''} onChange={(e) => onChange(field.key, e.target.value)} disabled={disabled} />
        </div>
      );
    }

    if (field.kind === 'select') {
      return (
        <div key={`${field.key}-${field.condition?.values.join('-') ?? 'all'}`}>
          <FieldLabel>{field.label}{field.required ? ' *' : ''}</FieldLabel>
          <Select required={field.required} value={typeof val === 'string' ? val : ''} onChange={(e) => onChange(field.key, e.target.value)} disabled={disabled}>
            <option value="">Select…</option>
            {(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
          </Select>
        </div>
      );
    }

    if (field.kind === 'calculated') {
      const calculated = calculatedValue(field);
      return (
        <div key={field.key}>
          <FieldLabel>{field.label}</FieldLabel>
          <Input value={calculated ?? ''} readOnly disabled />
          <FieldHint>Calculated automatically from the related measurements.</FieldHint>
        </div>
      );
    }

    return (
      <div key={field.key}>
        <FieldLabel>{field.label}{field.required ? ' *' : ''}</FieldLabel>
        <Input
          type={field.kind === 'number' ? 'number' : field.kind === 'datetime' ? 'datetime-local' : 'text'}
          step={field.step ?? (field.kind === 'number' ? 'any' : undefined)}
          placeholder={field.placeholder}
          required={field.required}
          value={field.kind === 'datetime' && typeof val === 'string' ? val.slice(0, 16) : val === null || val === undefined ? '' : String(val)}
          onChange={(e) => onChange(field.key, field.kind === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)}
          disabled={disabled}
        />
      </div>
    );
  }

  const visibleFields = config.fields.filter(isVisible);
  const textFields = visibleFields.filter((f) => f.kind !== 'photo' && f.kind !== 'photos');
  const photoFields = visibleFields.filter((f) => f.kind === 'photo' || f.kind === 'photos');

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
