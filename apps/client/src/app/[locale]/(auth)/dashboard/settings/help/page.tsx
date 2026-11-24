import { getTranslations } from 'next-intl/server';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { FeatureRequestCenter } from '@/features/settings/FeatureRequestCenter';

const FAQ_KEYS = ['q1', 'q2', 'q3', 'q4', 'q5'] as const;

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({
    locale: (await props.params).locale,
    namespace: 'Settings',
  });

  return {
    title: t('help_faq.meta_title'),
    description: t('help_faq.meta_description'),
  };
}

export default async function HelpAndFaqSettingsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const t = await getTranslations({
    locale: (await props.params).locale,
    namespace: 'Settings.help_faq',
  });

  return (
    <div className="space-y-6">
      <DashboardSection title={t('title')} description={t('description')}>
        <Accordion type="multiple" className="w-full">
          {FAQ_KEYS.map(key => (
            <AccordionItem key={key} value={key}>
              <AccordionTrigger>{t(`faq.${key}.question`)}</AccordionTrigger>
              <AccordionContent>{t(`faq.${key}.answer`)}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </DashboardSection>

      <DashboardSection
        title={t('request_feature.title')}
        description={t('request_feature.description')}
      >
        <FeatureRequestCenter />
      </DashboardSection>
    </div>
  );
}
