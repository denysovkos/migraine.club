import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { TrustBar } from '@/components/TrustBar';
import { Section } from '@/features/landing/Section';
import { AppConfig } from '@/utils/AppConfig';

import { Logo } from './Logo';

export const Footer = () => {
  const t = useTranslations('Footer');

  return (
    <Section className="pb-16 pt-6">
      <div className="mx-auto flex max-w-screen-lg flex-col items-center gap-4 text-center">
        <Logo />
        <p className="text-sm text-muted-foreground">{t('tagline')}</p>

        <div className="flex flex-wrap items-center justify-center gap-4 text-sm font-medium">
          <Link href="/product" className="hover:opacity-80">{t('product')}</Link>
          <Link href="/community" className="hover:opacity-80">{t('community')}</Link>
          <Link href="/install" className="hover:opacity-80">{t('install')}</Link>
          <Link href="/mcp" className="hover:opacity-80">{t('ai_connector')}</Link>
          <Link href="/privacy" className="hover:opacity-80">{t('privacy_policy')}</Link>
          <Link href="/terms" className="hover:opacity-80">{t('terms_of_service')}</Link>
        </div>

        <TrustBar className="mt-2 justify-center" />

        <div className="text-xs text-muted-foreground">
          {t('privacy_note')}
        </div>

        <div className="mt-6 flex w-full flex-col items-center justify-between gap-2 border-t pt-4 text-xs text-muted-foreground md:flex-row">
          <div>
            {`© ${new Date().getFullYear()} ${AppConfig.name}. `}
            {t('rights')}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link href="/privacy" className="hover:opacity-80">{t('privacy_policy')}</Link>
            <Link href="/terms" className="hover:opacity-80">{t('terms_of_service')}</Link>
          </div>
        </div>
      </div>
    </Section>
  );
};
