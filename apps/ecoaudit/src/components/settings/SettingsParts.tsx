import Link from 'next/link';
import type { ReactNode } from 'react';

export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 ml-1 text-[11px] font-bold uppercase tracking-wider text-[var(--text-sub)]">{title}</h2>
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">{children}</div>
    </section>
  );
}

export function SettingsMenuItem({
  href,
  onClick,
  icon,
  label,
  trailing,
}: {
  href?: string;
  onClick?: () => void;
  icon?: ReactNode;
  label: string;
  trailing?: ReactNode;
}) {
  const className =
    'flex w-full items-center gap-3 px-4 py-3 text-left text-[15px] text-[var(--text)] transition hover:bg-[var(--surface2)]';
  const inner = (
    <>
      {icon ? <span className="text-[var(--text-sub)]">{icon}</span> : null}
      <span className="flex-1">{label}</span>
      {trailing ?? <span className="text-[var(--muted)]">›</span>}
    </>
  );
  if (href) return <Link href={href} className={className}>{inner}</Link>;
  return (
    <button type="button" className={className} onClick={onClick}>
      {inner}
    </button>
  );
}

export function SettingsDivider() {
  return <div className="h-px bg-[var(--border)]" />;
}

export function SettingsInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
      <span className="text-[var(--text-sub)]">{label}</span>
      <span className="font-medium text-[var(--text)]">{value}</span>
    </div>
  );
}
