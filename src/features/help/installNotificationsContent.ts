export type InstallNotificationsTabId = 'ios' | 'android' | 'desktop';

export type InstallNotificationsSectionId = 'install' | 'notifications' | 'troubleshooting';

export type InstallNotificationsHelpSection = {
  id: InstallNotificationsSectionId;
  title: string;
  paragraphs: string[];
};

export type InstallNotificationsHelpTab = {
  id: InstallNotificationsTabId;
  label: string;
  subtitle?: string;
  sections: InstallNotificationsHelpSection[];
};

export type InstallNotificationsHelp = {
  title: string;
  intro: string;
  tabs: InstallNotificationsHelpTab[];
  microcopy: {
    iosTooltip: string;
    installTile: string;
    notificationsTile: string;
  };
};

export function buildInstallNotificationsHelp(
  t: (key: string) => string,
): InstallNotificationsHelp {
  return {
    title: t('title'),
    intro: t('intro'),
    tabs: [
      {
        id: 'ios',
        label: t('tabs.ios.label'),
        subtitle: t('tabs.ios.subtitle'),
        sections: [
          {
            id: 'install',
            title: t('tabs.ios.sections.install.title'),
            paragraphs: [
              t('tabs.ios.sections.install.p1'),
              t('tabs.ios.sections.install.p2'),
            ],
          },
          {
            id: 'notifications',
            title: t('tabs.ios.sections.notifications.title'),
            paragraphs: [
              t('tabs.ios.sections.notifications.p1'),
              t('tabs.ios.sections.notifications.p2'),
            ],
          },
          {
            id: 'troubleshooting',
            title: t('tabs.ios.sections.troubleshooting.title'),
            paragraphs: [t('tabs.ios.sections.troubleshooting.p1')],
          },
        ],
      },
      {
        id: 'android',
        label: t('tabs.android.label'),
        subtitle: t('tabs.android.subtitle'),
        sections: [
          {
            id: 'install',
            title: t('tabs.android.sections.install.title'),
            paragraphs: [t('tabs.android.sections.install.p1')],
          },
          {
            id: 'notifications',
            title: t('tabs.android.sections.notifications.title'),
            paragraphs: [t('tabs.android.sections.notifications.p1')],
          },
          {
            id: 'troubleshooting',
            title: t('tabs.android.sections.troubleshooting.title'),
            paragraphs: [t('tabs.android.sections.troubleshooting.p1')],
          },
        ],
      },
      {
        id: 'desktop',
        label: t('tabs.desktop.label'),
        subtitle: t('tabs.desktop.subtitle'),
        sections: [
          {
            id: 'install',
            title: t('tabs.desktop.sections.install.title'),
            paragraphs: [t('tabs.desktop.sections.install.p1')],
          },
          {
            id: 'notifications',
            title: t('tabs.desktop.sections.notifications.title'),
            paragraphs: [t('tabs.desktop.sections.notifications.p1')],
          },
          {
            id: 'troubleshooting',
            title: t('tabs.desktop.sections.troubleshooting.title'),
            paragraphs: [t('tabs.desktop.sections.troubleshooting.p1')],
          },
        ],
      },
    ] satisfies InstallNotificationsHelpTab[],
    microcopy: {
      iosTooltip: t('microcopy.iosTooltip'),
      installTile: t('microcopy.installTile'),
      notificationsTile: t('microcopy.notificationsTile'),
    },
  };
}
