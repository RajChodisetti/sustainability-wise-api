import Link from 'next/link';
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const variants: Record<ButtonVariant, string> = {
  primary:
    'border border-transparent bg-[var(--primary)] text-[var(--primary-fg)] shadow-[var(--shadow-xs)] hover:bg-[var(--primary-hover)] hover:shadow-[var(--shadow-sm)]',
  secondary:
    'border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-xs)] hover:border-[var(--primary)] hover:bg-[var(--primary-soft)] hover:text-[var(--primary)]',
  danger:
    'border border-transparent bg-[var(--red)] text-[var(--red-fg)] shadow-[var(--shadow-xs)] hover:brightness-90 hover:shadow-[var(--shadow-sm)]',
  ghost:
    'border border-transparent bg-transparent text-[var(--primary)] hover:bg-[var(--primary-soft)]',
};

export function buttonClassName(variant: ButtonVariant = 'primary', className = '') {
  return `inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-sm)] px-4 py-2 text-sm font-bold leading-5 no-underline transition disabled:pointer-events-none disabled:opacity-50 ${variants[variant]} ${className}`;
}

export function Button({
  variant = 'primary',
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; children: ReactNode }) {
  return (
    <button type="button" className={buttonClassName(variant, className)} {...props}>
      {children}
    </button>
  );
}

export function LinkButton({
  variant = 'primary',
  className = '',
  children,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; children: ReactNode }) {
  return (
    <Link className={buttonClassName(variant, className)} {...props}>
      {children}
    </Link>
  );
}
