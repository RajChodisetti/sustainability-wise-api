'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { FieldHint, FieldLabel, Input } from '@/components/ui/FormFields';

export type KnownReplacementMeter = {
  meterId: string;
  serialNumber: string;
  deviceNumber?: string | null;
  deviceModel?: string | null;
};

export const MAX_REPLACEMENT_METERS = 50;
export const MAX_REPLACEMENT_METER_NUMBER_LENGTH = 200;
export const MAX_STORED_REPLACEMENT_METER_NUMBERS_LENGTH = 10_000;

export function normalizeReplacementMeterNumbers(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const candidate of values) {
    const value = candidate.trim();
    const key = value.toLocaleLowerCase('en-AU');
    if (!value || seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }
  return normalized;
}

export function replacementMeterNumbersFromStored(value?: string | null): string[] {
  return normalizeReplacementMeterNumbers(value?.split(/\r?\n/) ?? []);
}

export function storedReplacementMeterNumbers(values: readonly string[]): string | null {
  const normalized = normalizeReplacementMeterNumbers(values);
  if (!normalized.length) return null;
  if (normalized.some((meterNumber) => meterNumber.length > MAX_REPLACEMENT_METER_NUMBER_LENGTH)) {
    throw new Error(
      `Each meter to replace must use at most ${MAX_REPLACEMENT_METER_NUMBER_LENGTH} characters.`,
    );
  }
  if (normalized.length > MAX_REPLACEMENT_METERS) {
    throw new Error(`Select at most ${MAX_REPLACEMENT_METERS} unique meters to replace.`);
  }
  const stored = normalized.join('\n');
  if (stored.length > MAX_STORED_REPLACEMENT_METER_NUMBERS_LENGTH) {
    throw new Error(
      `Meters to replace must use at most ${MAX_STORED_REPLACEMENT_METER_NUMBERS_LENGTH.toLocaleString('en-AU')} characters in total.`,
    );
  }
  return stored;
}

export function plannedReplacementMeterNumber(
  stored: string | null | undefined,
  query: string,
): string | null {
  const key = query.trim().toLocaleLowerCase('en-AU');
  if (!key) return null;
  return replacementMeterNumbersFromStored(stored)
    .find((meterNumber) => meterNumber.toLocaleLowerCase('en-AU') === key) ?? null;
}

function knownMeterLabel(meter: KnownReplacementMeter): string {
  return [
    meter.serialNumber,
    meter.deviceNumber && meter.deviceNumber !== meter.serialNumber
      ? `site tag ${meter.deviceNumber}`
      : '',
    meter.deviceModel,
  ].filter(Boolean).join(' · ');
}

export function ReplacementMeterPicker({
  id,
  value,
  knownMeters = [],
  disabled = false,
  onChange,
}: {
  id: string;
  value: string[];
  knownMeters?: KnownReplacementMeter[];
  disabled?: boolean;
  onChange: (value: string[]) => void;
}) {
  const [manualValue, setManualValue] = useState('');
  const selectedKeys = new Set(value.map((item) => item.toLocaleLowerCase('en-AU')));

  function add(valueToAdd: string) {
    const normalized = valueToAdd.trim();
    if (!normalized || normalized.length > MAX_REPLACEMENT_METER_NUMBER_LENGTH) return;
    onChange(normalizeReplacementMeterNumbers([...value, normalized]));
    setManualValue('');
  }

  function remove(valueToRemove: string) {
    const key = valueToRemove.toLocaleLowerCase('en-AU');
    onChange(value.filter((item) => item.toLocaleLowerCase('en-AU') !== key));
  }

  return (
    <div className="sm:col-span-2 lg:col-span-3">
      <FieldLabel htmlFor={`${id}-manual`}>Meters to replace</FieldLabel>
      <FieldHint>Select one or more known site meters, or add a meter number that is not listed.</FieldHint>
      {knownMeters.length ? (
        <fieldset className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-3">
          <legend className="px-1 text-xs font-extrabold text-[var(--text)]">Known meters at this site</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {knownMeters.map((meter) => {
              const checked = selectedKeys.has(meter.serialNumber.toLocaleLowerCase('en-AU'));
              return (
                <label key={meter.meterId} className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-sm font-semibold text-[var(--text)]">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled || (!checked && value.length >= MAX_REPLACEMENT_METERS)}
                    onChange={() => checked ? remove(meter.serialNumber) : add(meter.serialNumber)}
                  />
                  <span>{knownMeterLabel(meter)}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : (
        <p className="mt-2 text-xs font-semibold text-[var(--text-sub)]">No copied site meters are available to suggest.</p>
      )}
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <Input
          id={`${id}-manual`}
          value={manualValue}
          maxLength={MAX_REPLACEMENT_METER_NUMBER_LENGTH}
          disabled={disabled || value.length >= MAX_REPLACEMENT_METERS}
          placeholder="Enter another meter / device number"
          onChange={(event) => setManualValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            add(manualValue);
          }}
        />
        <Button
          type="button"
          variant="secondary"
          disabled={disabled || !manualValue.trim() || value.length >= MAX_REPLACEMENT_METERS}
          onClick={() => add(manualValue)}
        >
          Add meter
        </Button>
      </div>
      {value.length ? (
        <div className="mt-3 flex flex-wrap gap-2" aria-label="Selected meters to replace">
          {value.map((meterNumber) => (
            <button
              key={meterNumber.toLocaleLowerCase('en-AU')}
              type="button"
              disabled={disabled}
              className="rounded-full border border-[var(--primary)] bg-[var(--primary-soft)] px-3 py-1.5 text-xs font-extrabold text-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => remove(meterNumber)}
              aria-label={`Remove ${meterNumber}`}
            >
              {meterNumber} ×
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs font-bold text-[var(--red)]">Select or add at least one meter for an M2 job.</p>
      )}
    </div>
  );
}
