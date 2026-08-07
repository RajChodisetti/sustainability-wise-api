'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { Input } from '@/components/ui/FormFields';

export type SearchableSelectOption = {
  value: string;
  label: string;
  keywords?: string;
  disabled?: boolean;
};

export type SearchableSelectResult = {
  options: SearchableSelectOption[];
  totalMatches: number;
};

export function searchableSelectResult(
  options: readonly SearchableSelectOption[],
  query: string,
  selectedValue = '',
  limit = 100,
): SearchableSelectResult {
  const normalizedQuery = query.trim().toLocaleLowerCase('en-AU');
  const matches = options.filter((option) => (
    !normalizedQuery
    || `${option.label} ${option.keywords || ''}`
      .toLocaleLowerCase('en-AU')
      .includes(normalizedQuery)
  ));
  const boundedLimit = Math.max(1, limit);
  const visible = matches.slice(0, boundedLimit);
  const selected = selectedValue
    ? options.find((option) => option.value === selectedValue)
    : undefined;
  if (selected && !visible.some((option) => option.value === selected.value)) {
    visible.unshift(selected);
    visible.splice(boundedLimit);
  }
  return { options: visible, totalMatches: matches.length };
}

export function SearchableSelect({
  id,
  value,
  options,
  onChange,
  placeholder = 'Search and choose',
  listboxLabel = `${placeholder} choices`,
  emptyMessage = 'No matching choices.',
  disabled = false,
  required = false,
  invalid = false,
  describedBy,
  maxResults = 100,
  className = '',
}: {
  id: string;
  value: string;
  options: readonly SearchableSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  listboxLabel?: string;
  emptyMessage?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  describedBy?: string;
  maxResults?: number;
  className?: string;
}) {
  const generatedId = useId().replaceAll(':', '');
  const listboxId = `${id}-${generatedId}-listbox`;
  const statusId = `${id}-${generatedId}-status`;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const selectedOption = options.find((option) => option.value === value);

  const result = useMemo(
    () => searchableSelectResult(
      options,
      editing ? inputValue : '',
      editing ? '' : value,
      maxResults,
    ),
    [editing, inputValue, maxResults, options, value],
  );
  const enabledOptions = result.options.filter((option) => !option.disabled);
  const boundedActiveIndex = enabledOptions.length
    ? Math.min(activeIndex, enabledOptions.length - 1)
    : 0;
  const activeOption = enabledOptions[boundedActiveIndex];
  const activeOptionId = activeOption
    ? `${listboxId}-option-${result.options.findIndex((option) => option.value === activeOption.value)}`
    : undefined;

  useEffect(() => {
    if (!open || !activeOptionId) return;
    document.getElementById(activeOptionId)?.scrollIntoView({ block: 'nearest' });
  }, [activeOptionId, open]);

  function choose(option: SearchableSelectOption) {
    if (option.disabled) return;
    onChange(option.value);
    setInputValue(option.label);
    setEditing(false);
    setOpen(false);
    setActiveIndex(0);
  }

  function closeAndRestore() {
    setOpen(false);
    setEditing(false);
    setActiveIndex(0);
    setInputValue(options.find((option) => option.value === value)?.label || '');
  }

  return (
    <div className={`relative ${className}`}>
      <Input
        id={id}
        type="search"
        role="combobox"
        autoComplete="off"
        value={editing ? inputValue : selectedOption?.label || ''}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        aria-invalid={invalid}
        aria-expanded={disabled ? false : open}
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-activedescendant={open ? activeOptionId : undefined}
        aria-describedby={[describedBy, statusId].filter(Boolean).join(' ') || undefined}
        onFocus={(event) => {
          setEditing(false);
          setOpen(true);
          const selectedIndex = enabledOptions.findIndex((option) => option.value === value);
          setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
          event.currentTarget.select();
        }}
        onChange={(event) => {
          setInputValue(event.target.value);
          setEditing(true);
          setOpen(true);
          setActiveIndex(0);
        }}
        onBlur={() => window.setTimeout(closeAndRestore, 0)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
            if (!enabledOptions.length) return;
            setActiveIndex((current) => {
              if (event.key === 'ArrowDown') return (current + 1) % enabledOptions.length;
              return (current - 1 + enabledOptions.length) % enabledOptions.length;
            });
          } else if (event.key === 'Enter' && open && activeOption) {
            event.preventDefault();
            choose(activeOption);
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            closeAndRestore();
          }
        }}
      />
      <p id={statusId} className="sr-only" role="status" aria-live="polite">
        {open
          ? `${result.totalMatches} matching choice${result.totalMatches === 1 ? '' : 's'}. ${result.options.length} shown.`
          : selectedOption
            ? `${selectedOption.label} selected.`
            : 'No choice selected.'}
      </p>
      {open && !disabled ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label={listboxLabel}
          className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] p-1 shadow-xl"
        >
          {result.options.length ? result.options.map((option, index) => {
            const optionId = `${listboxId}-option-${index}`;
            const active = option.value === activeOption?.value;
            return (
              <button
                key={option.value}
                id={optionId}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={option.value === value}
                disabled={option.disabled}
                className={`block min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm transition-colors disabled:text-[var(--muted)] ${
                  active
                    ? 'bg-[var(--primary-soft)] text-[var(--text)]'
                    : 'text-[var(--text)] hover:bg-[var(--surface2)]'
                }`}
                onPointerDown={(event) => event.preventDefault()}
                onMouseEnter={() => {
                  const enabledIndex = enabledOptions.findIndex((candidate) => candidate.value === option.value);
                  if (enabledIndex >= 0) setActiveIndex(enabledIndex);
                }}
                onClick={() => choose(option)}
              >
                {option.label}
              </button>
            );
          }) : (
            <p className="px-3 py-3 text-sm text-[var(--text-sub)]">{emptyMessage}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
