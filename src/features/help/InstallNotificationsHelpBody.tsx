'use client';

import type { InstallNotificationsTabId } from '@/features/help/installNotificationsContent';

import { useTranslations } from 'next-intl';
import { HelpTabs } from '@/components/help/HelpTabs';
import { buildInstallNotificationsHelp } from '@/features/help/installNotificationsContent';

export function InstallNotificationsHelpBody(props: { initialTabId?: InstallNotificationsTabId }) {
  const t = useTranslations('HelpInstallNotifications');
  const help = buildInstallNotificationsHelp(t);

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{help.title}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{help.intro}</p>
      </header>

      <HelpTabs
        tabs={help.tabs}
        initialTabId={props.initialTabId}
      />
    </div>
  );
}
