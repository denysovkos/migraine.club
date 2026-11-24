'use client';

import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';

import { cn } from '@/utils/Helpers';

export type HelpTabsSection = {
  id: string;
  title: string;
  paragraphs: string[];
};

export type HelpTabsTab<TTabId extends string = string> = {
  id: TTabId;
  label: string;
  subtitle?: string;
  sections: HelpTabsSection[];
};

export function HelpTabs<TTabId extends string>(props: {
  tabs: HelpTabsTab<TTabId>[];
  initialTabId?: TTabId;
  value?: TTabId;
  className?: string;
  onTabChange?: (tabId: TTabId) => void;
}) {
  const t = useTranslations('HelpTabs');
  const tabs = props.tabs;

  const fallbackTabId = tabs[0]?.id;
  const initial = (props.initialTabId ?? fallbackTabId) as TTabId | undefined;
  const [uncontrolledTabId, setUncontrolledTabId] = useState<TTabId | undefined>(initial);
  const activeTabId = props.value ?? uncontrolledTabId;

  const activeTab = useMemo(
    () => tabs.find(t => t.id === activeTabId) ?? tabs[0],
    [activeTabId, tabs],
  );

  const instanceId = useId();

  if (!activeTab) {
    return null;
  }

  return (
    <section className={cn('w-full', props.className)}>
      <div
        role="tablist"
        aria-label={t('aria_label')}
        className="flex w-full gap-2 overflow-x-auto pb-1"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab.id;
          const tabId = `tab-${instanceId}-${tab.id}`;
          const panelId = `panel-${instanceId}-${tab.id}`;

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={tabId}
              aria-selected={isActive}
              aria-controls={panelId}
              className={cn(
                'min-h-[44px] shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
              onClick={() => {
                setUncontrolledTabId(tab.id);
                props.onTabChange?.(tab.id);
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        id={`panel-${instanceId}-${activeTab.id}`}
        role="tabpanel"
        aria-labelledby={`tab-${instanceId}-${activeTab.id}`}
        className="mt-4 rounded-xl border bg-card p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">
              {activeTab.label}
              {activeTab.subtitle
                ? (
                    <span className="ml-2 text-sm font-medium text-muted-foreground">
                      (
                      {activeTab.subtitle}
                      )
                    </span>
                  )
                : null}
            </h2>
          </div>

          <a
            href="#troubleshooting"
            className="min-h-[44px] shrink-0 rounded-md p-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('still_stuck')}
          </a>
        </div>

        <div className="mt-4 space-y-5">
          {activeTab.sections.map((section) => {
            const sectionId = section.id === 'troubleshooting' ? 'troubleshooting' : section.id;
            return (
              <section key={section.id} id={sectionId} className="scroll-mt-24">
                <h3 className="text-sm font-semibold">{section.title}</h3>
                <div className="mt-2 space-y-2">
                  {section.paragraphs.map(p => (
                    <p key={`${section.id}:${p}`} className="text-sm leading-relaxed text-muted-foreground">
                      {p}
                    </p>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </section>
  );
}
