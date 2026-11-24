import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { EpisodesList } from '@/features/episodes/EpisodesList';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({
    locale: (await props.params).locale,
    namespace: 'Episodes',
  });

  return {
    title: t('meta_title'),
    description: t('meta_description'),
  };
}

export default async function EpisodesPage() {
  const t = await getTranslations('Episodes');

  // For server components, we need to fetch episodes differently
  // Since we can't use cookies in fetch from server components easily,
  // we'll fetch them on the client side instead
  // For now, return empty array and let client fetch

  return (
    <>
      <TitleBar
        title={t('title_bar')}
        description={t('title_bar_description')}
      />

      <div className="mb-4 flex justify-end">
        <Button asChild>
          <Link href="/dashboard/episodes/new">{t('log_episode_button')}</Link>
        </Button>
      </div>

      <DashboardSection
        title={t('recent_episodes_title')}
        description={t('recent_episodes_description')}
      >
        <EpisodesList />
      </DashboardSection>
    </>
  );
}
