'use client';

import { Heart, Shield, Users, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

type CommunityGuidelinesProps = {
  onClose?: () => void;
};

export function CommunityGuidelines({ onClose }: CommunityGuidelinesProps) {
  const t = useTranslations('Community');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="size-5 text-primary" />
          <h2 className="text-lg font-semibold">{t('guidelines_title')}</h2>
        </div>
        {onClose && (
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="size-4" />
          </Button>
        )}
      </div>

      <p className="text-sm text-muted-foreground">{t('guidelines_intro')}</p>

      <ul className="space-y-3">
        <li className="flex items-start gap-2 text-sm">
          <Heart className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>{t('guideline_respect')}</span>
        </li>
        <li className="flex items-start gap-2 text-sm">
          <Shield className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>{t('guideline_no_harassment')}</span>
        </li>
        <li className="flex items-start gap-2 text-sm">
          <Users className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>{t('guideline_not_medical')}</span>
        </li>
        <li className="flex items-start gap-2 text-sm">
          <Shield className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>{t('guideline_no_pii')}</span>
        </li>
        <li className="flex items-start gap-2 text-sm">
          <Heart className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>{t('guideline_support')}</span>
        </li>
      </ul>
    </div>
  );
}

// Modal wrapper for guidelines
export function CommunityGuidelinesModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-card p-5 shadow-xl">
        <CommunityGuidelines onClose={onClose} />
      </div>
    </div>
  );
}

// Hook for guidelines modal
// eslint-disable-next-line react-refresh/only-export-components
export function useGuidelinesModal() {
  const [isOpen, setIsOpen] = useState(false);

  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    GuidelinesModal: () => (
      <CommunityGuidelinesModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    ),
  };
}
