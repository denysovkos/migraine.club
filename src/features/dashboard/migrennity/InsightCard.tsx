'use client';

import { Sparkles } from 'lucide-react';

export function InsightCard({
  eyebrow,
  title,
  body,
  caveat,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  body: React.ReactNode;
  caveat?: React.ReactNode;
}) {
  return (
    <section
      className="mc-card relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, var(--mc-brand-soft), var(--mc-surface) 60%)' }}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-xl"
          style={{ background: 'var(--mc-brand)', color: 'var(--mc-brand-fg)' }}
        >
          <Sparkles className="size-[18px]" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--mc-brand-press)' }}>
              {eyebrow}
            </div>
          )}
          <h3 className="mt-0.5 text-[16px] font-bold leading-tight" style={{ color: 'var(--mc-fg)' }}>
            {title}
          </h3>
          <p className="mt-1.5 text-[13px]" style={{ color: 'var(--mc-fg-2)' }}>
            {body}
            {caveat && (
              <span style={{ color: 'var(--mc-fg-muted)' }}>
                {' '}
                {caveat}
              </span>
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
