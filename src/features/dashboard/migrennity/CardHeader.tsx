'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

type Props = {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  action?: { label: string; href?: string; onClick?: () => void };
};

export function CardHeader({ eyebrow, title, sub, action }: Props) {
  const actionContent = action
    ? (
        <>
          {action.label}
          <ArrowRight className="size-3.5" strokeWidth={2} />
        </>
      )
    : null;
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--mc-fg-muted)' }}>
            {eyebrow}
          </div>
        )}
        <h3 className="text-[16px] font-bold leading-tight" style={{ color: 'var(--mc-fg)' }}>
          {title}
        </h3>
        {sub && (
          <p className="mt-1 text-[12.5px]" style={{ color: 'var(--mc-fg-muted)' }}>
            {sub}
          </p>
        )}
      </div>
      {action && (action.href
        ? (
            <Link
              href={action.href}
              className="mc-ring mt-0.5 flex shrink-0 items-center gap-1 text-[13px] font-semibold"
              style={{ color: 'var(--mc-brand-press)' }}
            >
              {actionContent}
            </Link>
          )
        : (
            <button
              type="button"
              onClick={action.onClick}
              className="mc-ring mt-0.5 flex shrink-0 items-center gap-1 text-[13px] font-semibold"
              style={{ color: 'var(--mc-brand-press)' }}
            >
              {actionContent}
            </button>
          ))}
    </div>
  );
}
