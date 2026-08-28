'use client';

import { useEffect, useId, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { FieldHint, FieldLabel, Input } from '@/components/ui/FormFields';
import { useSchedulerClients } from '@/modules/scheduler/hooks/useScheduler';
import type { SchedulerClient } from '@/modules/scheduler/types/routing';

function useDebouncedValue(value: string, delayMs = 250): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
}

export function SchedulerClientCombobox({
  value,
  selectedClientId,
  onInput,
  onSelect,
  disabled = false,
}: {
  value: string;
  selectedClientId?: string | null;
  onInput: (value: string) => void;
  onSelect: (client: SchedulerClient) => void;
  disabled?: boolean;
}) {
  const generatedId = useId().replaceAll(':', '');
  const inputId = `scheduler-client-${generatedId}`;
  const listboxId = `${inputId}-options`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debouncedQuery = useDebouncedValue(value.trim());
  const clientsQuery = useSchedulerClients(
    { q: debouncedQuery },
    open && !disabled,
  );
  const clients = clientsQuery.data?.clients ?? [];
  const safeActiveIndex = activeIndex >= 0 && activeIndex < clients.length ? activeIndex : -1;

  function chooseClient(client: SchedulerClient) {
    onSelect(client);
    setOpen(false);
    setActiveIndex(-1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (clients.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => Math.min(clients.length - 1, current + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => Math.max(0, current - 1));
      return;
    }
    if (event.key === 'Enter' && open && safeActiveIndex >= 0) {
      event.preventDefault();
      const selected = clients[safeActiveIndex];
      if (selected) chooseClient(selected);
    }
  }

  return (
    <div>
      <FieldLabel htmlFor={inputId}>Client name</FieldLabel>
      <div className="relative">
        <Input
          id={inputId}
          value={value}
          disabled={disabled}
          autoComplete="organization"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && clients.length > 0}
          aria-controls={listboxId}
          aria-activedescendant={safeActiveIndex >= 0 ? `${listboxId}-${safeActiveIndex}` : undefined}
          aria-busy={clientsQuery.isFetching}
          placeholder="Start typing a client name"
          maxLength={300}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          onChange={(event) => {
            onInput(event.target.value);
            setActiveIndex(-1);
            setOpen(true);
          }}
        />
        {open && clients.length > 0 ? (
          <div className="absolute z-40 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-md)]">
            <div id={listboxId} role="listbox" aria-label="Saved clients">
              {clients.map((client, index) => (
                <button
                  key={client.id}
                  id={`${listboxId}-${index}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={client.id === selectedClientId}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseClient(client)}
                  className={`block w-full rounded-lg px-3 py-2.5 text-left text-sm leading-5 ${
                    index === safeActiveIndex
                      ? 'bg-[var(--primary-soft)] text-[var(--primary)]'
                      : 'text-[var(--text)] hover:bg-[var(--surface2)]'
                  }`}
                >
                  <span className="block font-bold">{client.name}</span>
                  <span className="block text-xs text-[var(--text-sub)]">
                    {client.sites.length === 1
                      ? '1 saved address'
                      : `${client.sites.length} saved addresses`}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      {selectedClientId ? (
        <FieldHint>Saved client selected. Choose one of its addresses below or add a new one.</FieldHint>
      ) : clientsQuery.isFetching ? (
        <FieldHint>Searching saved clients…</FieldHint>
      ) : null}
      {clientsQuery.isError ? (
        <FieldHint>Saved client suggestions are temporarily unavailable. You can still enter a client name.</FieldHint>
      ) : null}
    </div>
  );
}
