'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { FieldHint, FieldLabel, Input, Select } from '@/components/ui/FormFields';
import { useSchedulerClientAddressSuggestions } from '@/modules/scheduler/hooks/useScheduler';
import {
  AUSTRALIAN_STATES,
  schedulerAddressPostcodeChange,
  schedulerAddressFromClientSuggestion,
  schedulerManualAddress,
  schedulerPostcodeLocalityLookupIsCurrent,
  uniquePostcodeLocalities,
} from '@/modules/scheduler/lib/routing';
import type {
  AustralianState,
  SchedulerClientAddressSuggestion,
  SchedulerJobAddressInput,
} from '@/modules/scheduler/types/routing';

const EMPTY_ADDRESS_SUGGESTIONS: SchedulerClientAddressSuggestion[] = [];

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
  clientId,
  onSuggestionSelected,
  onManualEdit,
  onAddNewAddress,
  disabled = false,
}: {
  value: SchedulerJobAddressInput;
  onChange: (value: SchedulerJobAddressInput) => void;
  clientId?: string | null;
  onSuggestionSelected?: (suggestion: SchedulerClientAddressSuggestion) => void;
  onManualEdit?: () => void;
  onAddNewAddress?: () => void;
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
  const addressQuery = useSchedulerClientAddressSuggestions(
    { clientId: clientId ?? undefined, query: debouncedAddress },
    !disabled && (Boolean(clientId) || debouncedAddress.length >= 3),
  );
  const postcodeQuery = useSchedulerClientAddressSuggestions(
    { postcode: debouncedPostcode },
    !disabled && /^\d{4}$/.test(debouncedPostcode),
  );
  const storedSuggestions = addressQuery.data?.storedSuggestions ?? EMPTY_ADDRESS_SUGGESTIONS;
  const providerSuggestions = addressQuery.data?.providerSuggestions ?? EMPTY_ADDRESS_SUGGESTIONS;
  const suggestions = useMemo(
    () => [...storedSuggestions, ...providerSuggestions],
    [providerSuggestions, storedSuggestions],
  );
  const safeActiveIndex = activeIndex >= 0 && activeIndex < suggestions.length
    ? activeIndex
    : -1;
  const localityOptions = useMemo(
    () => uniquePostcodeLocalities((postcodeQuery.data?.providerSuggestions ?? []).map(
      (suggestion) => suggestion.address,
    )),
    [postcodeQuery.data?.providerSuggestions],
  );

  useEffect(() => {
    if (!schedulerPostcodeLocalityLookupIsCurrent(value.postcode, debouncedPostcode)) return;
    if (localityOptions.length !== 1) return;
    const [only] = localityOptions;
    if (!only || (value.locality?.trim() && value.state)) return;
    onManualEdit?.();
    onChange(schedulerManualAddress(value, {
      locality: value.locality?.trim() || only.locality,
      state: value.state ?? only.state,
    }));
  }, [debouncedPostcode, localityOptions, onChange, onManualEdit, value]);

  function chooseSuggestion(suggestion: SchedulerClientAddressSuggestion) {
    onChange(schedulerAddressFromClientSuggestion(suggestion));
    onSuggestionSelected?.(suggestion);
    setOpen(false);
    setActiveIndex(-1);
  }

  function changeManually(next: SchedulerJobAddressInput) {
    onManualEdit?.();
    onChange(next);
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
      setActiveIndex(Math.min(suggestions.length - 1, safeActiveIndex + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(Math.max(0, safeActiveIndex - 1));
      return;
    }
    if (event.key === 'Enter' && open && safeActiveIndex >= 0) {
      event.preventDefault();
      const selected = suggestions[safeActiveIndex];
      if (selected) chooseSuggestion(selected);
    }
  }

  return (
    <div>
      {clientId && onAddNewAddress ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-3 py-2">
          <p className="text-xs font-semibold text-[var(--text-sub)]">
            Saved addresses are shown first. You can also create another address for this client.
          </p>
          <button
            type="button"
            className="min-h-9 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 text-xs font-extrabold text-[var(--primary)] hover:border-[var(--primary)]"
            onClick={() => {
              onAddNewAddress();
              setOpen(true);
              setActiveIndex(-1);
            }}
          >
            Add a new address
          </button>
        </div>
      ) : null}
      {clientId && storedSuggestions.length > 0 ? (
        <div className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2">
          <p className="px-1 text-xs font-extrabold text-[var(--text-sub)]">
            Saved addresses for this client
          </p>
          <div className="mt-1 grid gap-1">
            {storedSuggestions.map((suggestion) => (
              <button
                key={`saved-shortcut-${suggestion.id}`}
                type="button"
                className="rounded-lg px-2.5 py-2 text-left text-sm hover:bg-[var(--surface2)]"
                onClick={() => chooseSuggestion(suggestion)}
              >
                <span className="block font-bold text-[var(--text)]">
                  {suggestion.siteName ?? 'Saved site'}
                </span>
                <span className="block text-xs text-[var(--text-sub)]">{suggestion.label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
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
          aria-activedescendant={safeActiveIndex >= 0 ? `${listboxId}-${safeActiveIndex}` : undefined}
          aria-busy={addressQuery.isFetching}
          placeholder="Start typing an Australian address"
          maxLength={1000}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={onAddressKeyDown}
          onChange={(event) => {
            changeManually(schedulerManualAddress(value, { freeform: event.target.value }));
            setActiveIndex(-1);
            setOpen(true);
          }}
        />
        {open && suggestions.length > 0 ? (
          <div className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-md)]">
            <div id={listboxId} role="listbox" aria-label="Saved and Australian address suggestions">
              {storedSuggestions.length > 0 ? (
                <p role="presentation" className="px-3 pb-1 pt-1 text-[10px] font-extrabold uppercase tracking-[0.08em] text-[var(--muted)]">
                  Saved for this client
                </p>
              ) : null}
              {storedSuggestions.map((suggestion, index) => (
                <button
                  key={suggestion.id}
                  id={`${listboxId}-${index}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={index === safeActiveIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseSuggestion(suggestion)}
                  className={`block w-full rounded-lg px-3 py-2.5 text-left text-sm leading-5 ${
                    index === safeActiveIndex
                      ? 'bg-[var(--primary-soft)] text-[var(--primary)]'
                      : 'text-[var(--text)] hover:bg-[var(--surface2)]'
                  }`}
                >
                  <span className="block font-bold">{suggestion.siteName ?? 'Saved site'}</span>
                  <span className="block text-xs text-[var(--text-sub)]">{suggestion.label}</span>
                </button>
              ))}
              {providerSuggestions.length > 0 ? (
                <p role="presentation" className="mt-1 border-t border-[var(--border)] px-3 pb-1 pt-2 text-[10px] font-extrabold uppercase tracking-[0.08em] text-[var(--muted)]">
                  Australian address suggestions
                </p>
              ) : null}
              {providerSuggestions.map((suggestion, providerIndex) => {
                const index = storedSuggestions.length + providerIndex;
                return (
                  <button
                    key={suggestion.id}
                    id={`${listboxId}-${index}`}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={index === safeActiveIndex}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => chooseSuggestion(suggestion)}
                    className={`block w-full rounded-lg px-3 py-2.5 text-left text-sm leading-5 ${
                      index === safeActiveIndex
                        ? 'bg-[var(--primary-soft)] text-[var(--primary)]'
                        : 'text-[var(--text)] hover:bg-[var(--surface2)]'
                    }`}
                  >
                    {suggestion.label}
                  </button>
                );
              })}
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
            onChange={(event) => changeManually(
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
            onChange={(event) => changeManually(schedulerManualAddress(value, {
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
        onChange={(event) => changeManually(schedulerManualAddress(value, {
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
                onClick={() => changeManually(schedulerManualAddress(value, option))}
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
