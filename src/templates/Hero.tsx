import { HeartHandshake, Stethoscope } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { buttonVariants } from '@/components/ui/buttonVariants';
import { Section } from '@/features/landing/Section';

export const Hero = () => {
  const t = useTranslations('Hero');
  const previewWpi = '6.8';

  return (
    <Section className="pb-10 pt-20 md:pt-24">
      <div className="mx-auto flex max-w-screen-lg flex-col items-center gap-10 md:flex-row md:items-start">
        {/* Left: copy + CTAs */}
        <div className="w-full flex-1 space-y-5 text-center md:text-left">
          <p className="inline-flex items-center justify-center rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary md:justify-start">
            {t('follow_twitter')}
          </p>

          <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
            {t('title')}
          </h1>

          <p className="text-balance text-base text-muted-foreground sm:text-lg">
            {t('description')}
          </p>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:justify-start">
            <Link
              href="/sign-up"
              className={buttonVariants({ size: 'lg' })}
            >
              {t('primary_button')}
            </Link>

            <Link
              href="/product"
              className={buttonVariants({ variant: 'outline', size: 'lg' })}
            >
              {t('secondary_button')}
            </Link>
          </div>

          <p className="mt-3 text-sm text-muted-foreground">
            {t('tagline')}
          </p>
        </div>

        {/* Right: simple app + community visual */}
        <div className="w-full flex-1">
          <div className="relative mx-auto max-w-sm">
            <div className="rounded-2xl border bg-card p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="inline-flex size-8 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                    M
                  </span>
                  <div>
                    <p className="text-sm font-medium">{t('preview_title')}</p>
                    <p className="text-xs text-muted-foreground">{t('preview_subtitle')}</p>
                  </div>
                </div>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                  {t('preview_wpi_badge', { score: previewWpi })}
                </span>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
                  <span className="font-medium">{t('preview_last7_title')}</span>
                  <span className="text-muted-foreground">{t('preview_last7_value')}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2">
                  <span className="text-muted-foreground">{t('preview_top_triggers_label')}</span>
                  <span className="font-medium">{t('preview_top_triggers_value')}</span>
                </div>
              </div>
            </div>

            <div className="pointer-events-none absolute -bottom-6 -right-4 w-40 rounded-2xl border bg-background p-3 shadow-lg">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium">
                <HeartHandshake className="size-4 text-primary" />
                <span>{t('community_checkin_title')}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('community_checkin_quote')}
              </p>
              <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                <Stethoscope className="size-3" />
                <span>{t('community_doctor_reply')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
};
