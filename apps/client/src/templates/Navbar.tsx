'use client';

import { Show, UserButton } from '@clerk/nextjs';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { CenteredMenu } from '@/features/landing/CenteredMenu';
import { Section } from '@/features/landing/Section';

import { Logo } from './Logo';

export const Navbar = () => {
  const t = useTranslations('Navbar');

  return (
    <Section className="px-3 py-6">
      <CenteredMenu
        logo={<Logo />}
        rightMenu={(
          <>
            <li data-fade>
              <LocaleSwitcher />
            </li>
            <Show when="signed-in">
              <li>
                <UserButton
                  userProfileMode="navigation"
                  userProfileUrl="/dashboard/settings/account"
                  appearance={{
                    elements: {
                      rootBox: 'px-2 py-1.5',
                    },
                  }}
                />
              </li>
            </Show>
            <Show when="signed-in">
              <li>
                <Link className={buttonVariants({ size: 'sm' })} href="/dashboard">
                  {t('open_app')}
                </Link>
              </li>
            </Show>
            <Show when="signed-out">
              <li>
                <Link className={buttonVariants({ size: 'sm' })} href="/sign-in">
                  {t('open_app')}
                </Link>
              </li>
            </Show>
          </>
        )}
      >
        <li>
          <Link href="/product">{t('product')}</Link>
        </li>

        <li>
          <Link href="/community">{t('community')}</Link>
        </li>

        <li>
          <Link href="/install">{t('install')}</Link>
        </li>

        <li>
          <Link href="/mcp">{t('mcp')}</Link>
        </li>
      </CenteredMenu>
    </Section>
  );
};
