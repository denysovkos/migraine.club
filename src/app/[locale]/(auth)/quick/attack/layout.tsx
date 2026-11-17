import type { Viewport } from 'next';
import { RedirectToSignIn, Show } from '@clerk/nextjs';
import { getTranslations } from 'next-intl/server';
import { OfflineSyncProvider } from '@/features/offline/OfflineSyncProvider';
import { requireUserOrRedirect } from '@/libs/AuthGuard';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({ locale: (await props.params).locale, namespace: 'AttackMode' });
  return {
    title: t('meta_title'),
    robots: { index: false, follow: false },
  };
}

// Black browser chrome on mobile, so nothing around the page lights up.
export const viewport: Viewport = {
  themeColor: '#000000',
  colorScheme: 'dark',
};

export default async function AttackModeLayout(props: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  await requireUserOrRedirect(locale);

  return (
    <>
      <Show when="signed-out">
        <RedirectToSignIn />
      </Show>
      {/* Attack mode reports offline saves in its own quiet status line. */}
      <OfflineSyncProvider showIndicator={false}>
        {props.children}
      </OfflineSyncProvider>
    </>
  );
}

export const dynamic = 'force-dynamic';
