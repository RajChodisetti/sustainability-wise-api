'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { FieldHint, FieldLabel, Input, Select } from '@/components/ui/FormFields';
import { useSchedulerAddressSuggestions } from '@/modules/scheduler/hooks/useScheduler';
import {
  AUSTRALIAN_STATES,
  schedulerAddressPostcodeChange,
  schedulerAddressFromSuggestion,
  schedulerManualAddress,
  uniquePostcodeLocalities,
} from '@/modules/scheduler/lib/routing';
import type {
  AustralianState,
  SchedulerAddressSuggestion,
  SchedulerJobAddressInput,
} from '@/modules/scheduler/types/routing';

function useDebouncedValue(value: string, delayMs = 300): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
}

export function AustralianAddressFields({
  value,
  onChange,
  disabled = false,
}: {
  value: SchedulerJobAddressInput;
  onChange: (value: SchedulerJobAddressInput) => void;
  disabled?: boolean;
}) {
  const generatedId = useId().replaceAll(':', '');
  const addressId = `scheduler-address-${generatedId}`;
  const postcodeId = `${addressId}-postcode`;
  const stateId = `${addressId}-state`;
  const localityId = `${addressId}-locality`;
  const listboxId = `${addressId}-suggestions`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debouncedAddress = useDebouncedValue(value.freeform.trim());
  const debouncedPostcode = useDebouncedValue(value.postcode?.trim() ?? '');
  const addressQuery = useSchedulerAddressSuggestions(
    { query: debouncedAddress },
    !disabled && debouncedAddress.length >= 3,
  );
  const postcodeQuery = useSchedulerAddressSuggestions(
    { postcode: debouncedPostcode },
    !disabled && /^\d{4}$/.test(debouncedPostcode),
  );
  const suggestions = addressQuery.data?.suggestions ?? [];
  const localityOptions = useMemo(
    () => uniquePostcodeLocalities(postcodeQuery.data?.suggestions ?? []),
    [postcodeQuery.data?.suggestions],
  );

  useEffect(() => {
    if (localityOptions.length !== 1) return;
    const [only] = localityOptions;
    if (!only || (value.locality?.trim() && value.state)) return;
    onChange(schedulerManualAddress(value, {
      locality: value.locality?.trim() || only.locality,
      state: value.state ?? only.state,
    }));
  }, [localityOptions, onChange, value]);

  function chooseSuggestion(suggestion: SchedulerAddressSuggestion) {
    onChange(schedulerAddressFromSuggestion(suggestion));
    setOpen(false);
    setActiveIndex(-1);
  }

  function onAddressKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (suggestions.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => Math.min(suggestions.length - 1, current + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => Math.max(0, current - 1));
      return;
    }
    if (event.key === 'Enter' && open && activeIndex >= 0) {
      event.preventDefault();
      const selected = suggestions[activeIndex];
      if (selected) chooseSuggestion(selected);
    }
  }

  return (
    <div>
      <FieldLabel htmlFor={addressId}>Street address</FieldLabel>
      <div className="relative">
        <Input
          id={addressId}
          value={value.freeform}
          disabled={disabled}
          autoComplete="street-address"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && suggestions.length > 0}
          aria-controls={listboxId}
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
          aria-busy={addressQuery.isFetching}
          placeholder="Start typing an Australian address"
          maxLength={1000}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={onAddressKeyDown}
          onChange={(event) => {
            onChange(schedulerManualAddress(value, { freeform: event.target.value }));
            setActiveIndex(-1);
            setOpen(true);
          }}
        />
        {open && suggestions.length > 0 ? (
          <div className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-md)]">
            <div id={listboxId} role="listbox" aria-label="Australian address suggestions">
              {suggestions.map((suggestion, index) => (
                <button
                  key={suggestion.id}
                  id={`${listboxId}-${index}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={index === activeIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseSuggestion(suggestion)}
                  className={`block w-full rounded-lg px-3 py-2.5 text-left text-sm leading-5 ${
                    index === activeIndex
                      ? 'bg-[var(--primary-soft)] text-[var(--primary)]'
                      : 'text-[var(--text)] hover:bg-[var(--surface2)]'
                  }`}
                >
                  {suggestion.label}
                </button>
              ))}
            </div>
            {addressQuery.data?.attribution ? (
              <p className="px-3 py-1 text-[10px] text-[var(--muted)]">
                {addressQuery.data.attribution}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      {addressQuery.isFetching ? <FieldHint>Searching Australian addresses…</FieldHint> : null}
      {addressQuery.isError ? (
        <FieldHint>Address suggestions are temporarily unavailable. You can still enter the address manually.</FieldHint>
      ) : null}

      <div className="grid gap-x-3 sm:grid-cols-2">
        <div>
          <FieldLabel htmlFor={postcodeId}>Postcode</FieldLabel>
          <Input
            id={postcodeId}
            value={value.postcode ?? ''}
            disabled={disabled}
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={4}
            pattern="[0-9]{4}"
            placeholder="2000"
            onChange={(event) => onChange(
              schedulerAddressPostcodeChange(value, event.target.value),
            )}
          />
        </div>
        <div>
          <FieldLabel htmlFor={stateId}>State / territory</FieldLabel>
          <Select
            id={stateId}
            value={value.state ?? ''}
            disabled={disabled}
            autoComplete="address-level1"
            onChange={(event) => onChange(schedulerManualAddress(value, {
              state: (event.target.value || undefined) as AustralianState | undefined,
            }))}
          >
            <option value="">Select state</option>
            {AUSTRALIAN_STATES.map((state) => (
              <option key={state.value} value={state.value}>{state.value} · {state.label}</option>
            ))}
          </Select>
        </div>
      </div>

      <FieldLabel htmlFor={localityId}>Suburb / city</FieldLabel>
      <Input
        id={localityId}
        value={value.locality ?? ''}
        disabled={disabled}
        autoComplete="address-level2"
        maxLength={200}
        placeholder="Sydney"
        onChange={(event) => onChange(schedulerManualAddress(value, {
          locality: event.target.value,
        }))}
      />
      {localityOptions.length > 1 ? (
        <div className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2">
          <p className="px-1 text-xs font-bold text-[var(--text-sub)]">
            This postcode has multiple localities. Choose the right one:
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {localityOptions.map((option) => (
              <button
                key={`${option.locality}-${option.state}`}
                type="button"
                className="min-h-9 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1 text-xs font-bold text-[var(--text)] hover:border-[var(--primary)] hover:text-[var(--primary)]"
                onClick={() => onChange(schedulerManualAddress(value, option))}
              >
                {option.locality}, {option.state}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {postcodeQuery.isFetching ? <FieldHint>Looking up postcode localities…</FieldHint> : null}
      {postcodeQuery.isError ? (
        <FieldHint>Postcode lookup is temporarily unavailable. Enter the suburb and state manually.</FieldHint>
      ) : null}
    </div>
  );
}
