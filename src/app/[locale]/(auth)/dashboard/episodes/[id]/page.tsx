import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { EpisodeDetail } from '@/features/episodes/EpisodeDetail';

export async function generateMetadata(props: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const params = await props.params;
  const t = await getTranslations({
    locale: params.locale,
    namespace: 'EditEpisode',
  });

  return {
    title: t('meta_title'),
    description: t('meta_description'),
  };
}

export default async function EditEpisodePage(props: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const params = await props.params;
  const t = await getTranslations('EditEpisode');
  const episodeId = Number.parseInt(params.id, 10);

  if (Number.isNaN(episodeId)) {
    notFound();
  }

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
        <EpisodeDetail episodeId={episodeId} />
      </DashboardSection>
    </>
  );
}
