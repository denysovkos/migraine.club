import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { headers } from 'next/headers';

import { detectInstallNotificationsTabFromUserAgent } from '@/features/help/detectInstallNotificationsTab';
import { InstallNotificationsHelpBody } from '@/features/help/InstallNotificationsHelpBody';
import { Section } from '@/features/landing/Section';
import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';
import { getPageAlternates } from '@/utils/seo';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const t = await getTranslations({
    locale: (await props.params).locale,
    namespace: 'HelpInstallNotifications',
  });

  return {
    title: t('meta_title'),
    description: t('meta_description'),
    alternates: getPageAlternates((await props.params).locale, '/help/install-notifications'),
    openGraph: {
      title: t('meta_title'),
      description: t('meta_description'),
      url: getPageAlternates((await props.params).locale, '/help/install-notifications').canonical,
    },
    twitter: {
      title: t('meta_title'),
      description: t('meta_description'),
    },
  };
}

export default async function InstallNotificationsHelpPage(props: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await props.params).locale);

  const ua = (await headers()).get('user-agent');
  const initialTabId = detectInstallNotificationsTabFromUserAgent(ua);

  return (
    <>
      <Navbar />
      <Section className="py-10">
        <div className="mx-auto max-w-2xl">
          <InstallNotificationsHelpBody initialTabId={initialTabId} />
        </div>
      </Section>
      <Footer />
    </>
  );
}
