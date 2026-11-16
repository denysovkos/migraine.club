import { UserProfile } from '@clerk/nextjs';
import { getTranslations } from 'next-intl/server';

import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { getI18nPath } from '@/utils/Helpers';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({
    locale: (await props.params).locale,
    namespace: 'Settings',
  });

  return {
    title: t('account.meta_title'),
    description: t('account.meta_description'),
  };
}

/**
 * Catch-all route for Clerk UserProfile sub-routes (e.g., /settings/account/security).
 * Clerk uses path-based routing so we need a catch-all to handle its internal navigation.
 */
export default async function AccountSettingsCatchAllPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const t = await getTranslations({
    locale: (await props.params).locale,
    namespace: 'Settings',
  });

  return (
    <DashboardSection
      title={t('account.title')}
      description={t('account.description')}
    >
      <UserProfile
        routing="path"
        path={getI18nPath('/dashboard/settings/account', (await props.params).locale)}
        appearance={{
          elements: {
            rootBox: 'w-full',
            cardBox: 'w-full flex shadow-none border-0',
            card: 'shadow-none border-0 bg-transparent w-full',
            navbar: 'hidden',
            navbarMobileMenuRow: 'hidden',
            scrollBox: 'rounded-lg',
            pageScrollBox: 'p-0',
            page: 'gap-4',
            profileSection: 'gap-4',
            profileSectionTitle: 'border-b-0 pb-0',
            profileSectionTitleText: 'text-base font-medium text-foreground',
            profileSectionContent: 'gap-3',
            profileSectionPrimaryButton: 'text-primary hover:bg-primary/10',
            formButtonPrimary:
              'bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm',
            formFieldInput:
              'rounded-md border-input bg-background text-foreground focus:ring-2 focus:ring-ring focus:ring-offset-2',
            formFieldLabel: 'text-sm font-medium text-foreground',
            userPreviewMainIdentifier: 'text-foreground font-medium',
            userPreviewSecondaryIdentifier: 'text-muted-foreground',
            accordionTriggerButton: 'text-foreground hover:bg-muted',
            accordionContent: 'border-t border-border',
            badge: 'bg-primary/10 text-primary border-0',
            avatarBox: 'rounded-full',
            userButtonPopoverCard: 'shadow-lg border border-border',
          },
          variables: {
            colorPrimary: 'hsl(234, 100%, 71%)',
            colorBackground: 'transparent',
            colorText: 'hsl(215, 28%, 17%)',
            colorTextSecondary: 'hsl(215, 16%, 47%)',
            colorInputBackground: 'hsl(0, 0%, 100%)',
            colorInputText: 'hsl(215, 28%, 17%)',
            borderRadius: '0.75rem',
            fontFamily: 'Inter, system-ui, sans-serif',
          },
        }}
      />
    </DashboardSection>
  );
}
