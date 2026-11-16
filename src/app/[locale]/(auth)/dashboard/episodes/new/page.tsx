import { getTranslations } from 'next-intl/server';

import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { EpisodeForm } from '@/features/episodes/EpisodeForm';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({
    locale: (await props.params).locale,
    namespace: 'NewEpisode',
  });

  return {
    title: t('meta_title'),
    description: t('meta_description'),
  };
}

export default async function NewEpisodePage() {
  const t = await getTranslations('NewEpisode');

  return (
    <>
      <TitleBar
        title={t('title_bar')}
        description={t('title_bar_description')}
      />

      <DashboardSection
        title={t('section_title')}
        description={t('section_description')}
      >
        <EpisodeForm />
      </DashboardSection>
    </>
  );
}
