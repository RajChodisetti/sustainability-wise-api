'use client';

import { useEffect, useId, useRef } from 'react';
import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

const controlClass =
  'w-full min-h-11 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 py-2.5 text-base text-[var(--text)] shadow-[var(--shadow-xs)] outline-none hover:border-[var(--muted)] focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 disabled:bg-[var(--surface2)] disabled:text-[var(--muted)] sm:text-sm';

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${controlClass} ${className}`} {...props} />;
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${controlClass} min-h-28 resize-y leading-6 ${className}`} {...props} />;
}

export function FieldLabel({
  children,
  className = '',
  htmlFor,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & { children: ReactNode }) {
  const labelRef = useRef<HTMLLabelElement>(null);
  const generatedId = useId();

  useEffect(() => {
    if (htmlFor || !labelRef.current) return;
    let sibling = labelRef.current.nextElementSibling;
    let control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null = null;
    while (sibling && sibling.tagName.toLowerCase() !== 'label') {
      if (sibling.matches('input, select, textarea')) {
        control = sibling as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        break;
      }
      control = sibling.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea');
      if (control) break;
      sibling = sibling.nextElementSibling;
    }
    if (!control) return;
    if (!control.id) control.id = `field-${generatedId.replaceAll(':', '')}`;
    labelRef.current.htmlFor = control.id;
  }, [generatedId, htmlFor]);

  return (
    <label ref={labelRef} htmlFor={htmlFor} className={`mb-1.5 mt-4 block text-sm font-bold text-[var(--text)] ${className}`} {...props}>
      {children}
    </label>
  );
}

export function FieldError({ message, id }: { message?: string; id?: string }) {
  if (!message) return null;
  return <p id={id} className="mt-1.5 text-xs font-semibold text-[var(--red)]" role="alert">{message}</p>;
}

export function FieldHint({ children, id }: { children: ReactNode; id?: string }) {
  return <p id={id} className="mt-1.5 text-xs leading-5 text-[var(--text-sub)]">{children}</p>;
}

export function Select({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${controlClass} appearance-auto ${className}`} {...props}>
      {children}
    </select>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
  ariaDescribedBy,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  ariaDescribedBy?: string;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg py-1 text-sm font-medium text-[var(--text)]">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={ariaDescribedBy}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 shrink-0 accent-[var(--primary)]"
      />
      <span>{label}</span>
    </label>
  );
}
