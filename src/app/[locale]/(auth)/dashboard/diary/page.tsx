import { CalendarDays } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { TitleBar } from '@/features/dashboard/TitleBar';
import { DiaryView } from '@/features/diary/DiaryView';

export default function DiaryPage() {
  const t = useTranslations('Diary');

  return (
    <>
      <TitleBar
        title={(
          <span className="flex items-center gap-2">
            <CalendarDays className="size-6" />
            {t('page_title')}
          </span>
        )}
        description={t('page_description')}
      />
      <DiaryView />
    </>
  );
}
