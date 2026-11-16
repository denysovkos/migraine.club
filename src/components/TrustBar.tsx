import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { cn } from '@/utils/Helpers';

type TrustBarProps = {
  className?: string;
  compact?: boolean;
};

export const TrustBar = ({ className, compact }: TrustBarProps) => {
  const t = useTranslations('TrustBar');

  const items = [
    {
      label: t('evidence_first'),
    },
    {
      label: t('privacy_first'),
    },
    {
      label: t('secured_by_clerk'),
      href: 'https://clerk.com/user-authentication',
    },
    {
      label: t('hipaa_ready_neon'),
      href: 'https://neon.com/docs/security/hipaa',
    },
  ];

  const visibleItems = compact ? items.slice(0, 2) : items;

  return (
    <div className={cn('flex flex-wrap items-center gap-2 text-xs text-muted-foreground', className)}>
      {visibleItems.map(item => (
        item.href
          ? (
              <Link
                key={item.label}
                href={item.href}
                className="rounded-full border px-3 py-1 hover:text-foreground"
                target="_blank"
                rel="noreferrer"
              >
                {item.label}
              </Link>
            )
          : (
              <span
                key={item.label}
                className="rounded-full border px-3 py-1"
              >
                {item.label}
              </span>
            )
      ))}
    </div>
  );
};
