import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const variants: Record<Variant, string> = {
  primary: 'bg-[var(--primary)] text-[var(--primary-fg)] hover:opacity-90',
  secondary: 'bg-[var(--surface2)] text-[var(--text)] border border-[var(--border)] hover:bg-[var(--surface)]',
  danger: 'bg-[var(--red)] text-white hover:opacity-90',
  ghost: 'text-[var(--primary)] hover:bg-[var(--surface2)]',
};

export function Button({
  variant = 'primary',
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; children: ReactNode }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
