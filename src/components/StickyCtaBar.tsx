import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { buttonVariants } from '@/components/ui/buttonVariants';
import { cn } from '@/utils/Helpers';

export const StickyCtaBar = (props: { className?: string }) => {
  const t = useTranslations('StickyCta');

  return (
    <div
      className={cn(
        'fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur md:hidden',
        props.className,
      )}
    >
      <div className="mx-auto flex max-w-screen-md items-center gap-2 px-3 py-2">
        <Link
          href="/sign-up"
          className={buttonVariants({ size: 'sm', className: 'flex-1' })}
        >
          {t('start_free')}
        </Link>
        <Link
          href="/install"
          className={buttonVariants({ size: 'sm', variant: 'outline', className: 'flex-1' })}
        >
          {t('install')}
        </Link>
      </div>
    </div>
  );
};
