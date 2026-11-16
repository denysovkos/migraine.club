'use client';

import { AlertTriangle, Heart, Shield } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

type HealthDataConsentModalProps = {
  onConsent: () => void | Promise<boolean> | Promise<void>;
  isLoading?: boolean;
};

export function HealthDataConsentModal({ onConsent, isLoading }: HealthDataConsentModalProps) {
  const t = useTranslations('HealthDataConsent');
  const [isChecked, setIsChecked] = useState(false);

  const handleSubmit = async () => {
    if (!isChecked) {
      return;
    }
    await onConsent();
  };

  return (
    <div className="inset-0 z-50 flex items-center justify-center overflow-auto bg-background/80 p-0 backdrop-blur-sm">
      <div
        className="w-full max-w-lg rounded-xl border bg-card shadow-xl"
        role="dialog"
        aria-labelledby="health-consent-title"
        aria-describedby="health-consent-description"
      >
        <div className="border-b p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-primary/10 p-2">
              <Heart className="size-6 text-primary" />
            </div>
            <div>
              <h2 id="health-consent-title" className="text-xl font-semibold">
                {t('title')}
              </h2>
              <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-6">
          <p id="health-consent-description" className="text-sm text-muted-foreground">
            {t('description')}
          </p>
          <p className="text-sm text-muted-foreground">
            {t('terms_privacy_required')}
          </p>

          <div className="rounded-lg border bg-muted/50 p-4">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <Shield className="size-4 text-primary" />
              {t('what_we_store_title')}
            </h3>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li>
                {t('what_we_store_item1')}
              </li>
              <li>
                {t('what_we_store_item2')}
              </li>
              <li>
                {t('what_we_store_item3')}
              </li>
              <li>
                {t('what_we_store_item4')}
              </li>
            </ul>
          </div>

          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/30">
            <h3 className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
              <AlertTriangle className="size-4" />
              {t('withdraw_title')}
            </h3>
            <p className="mt-1 text-sm text-amber-600 dark:text-amber-300/80">
              {t('withdraw_text')}
            </p>
          </div>

          <div className="flex items-start gap-3 rounded-lg border p-4">
            <input
              type="checkbox"
              id="health-consent-checkbox"
              checked={isChecked}
              onChange={e => setIsChecked(e.target.checked)}
              className="mt-1 size-4 shrink-0 rounded border-gray-300"
            />
            <label htmlFor="health-consent-checkbox" className="text-sm leading-relaxed">
              {t('consent_checkbox_label_prefix')}
              {' '}
              <Link href="/terms" className="text-primary underline hover:no-underline" target="_blank">
                {t('terms_of_use_link')}
              </Link>
              {' '}
              {t('consent_checkbox_label_and')}
              {' '}
              <Link href="/privacy" className="text-primary underline hover:no-underline" target="_blank">
                {t('privacy_policy_link')}
              </Link>
              {t('consent_checkbox_label_suffix')}
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t bg-muted/30 px-6 py-4">
          <Button
            onClick={handleSubmit}
            disabled={!isChecked || isLoading}
          >
            {isLoading ? t('submitting') : t('submit_button')}
          </Button>
        </div>
      </div>
    </div>
  );
}
