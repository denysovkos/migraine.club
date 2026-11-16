import { ClipboardList } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { TitleBar } from '@/features/dashboard/TitleBar';
import { QuestionnairesView } from '@/features/questionnaires/QuestionnairesView';

export default function QuestionnairesPage() {
  const t = useTranslations('Questionnaires');

  return (
    <>
      <TitleBar
        title={(
          <span className="flex items-center gap-2">
            <ClipboardList className="size-6" />
            {t('title')}
          </span>
        )}
        description={t('description')}
      />
      <QuestionnairesView />
    </>
  );
}
