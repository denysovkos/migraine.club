'use client';

import { Lightbulb, Shield, Stethoscope } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { ProtectFallback } from '@/features/auth/ProtectFallback';
import { useUserRole } from '@/hooks/useModeration';

export function AdminHub() {
  const t = useTranslations('Admin');
  const { isAdmin, loading } = useUserRole();

  if (loading) {
    return null;
  }

  if (!isAdmin) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <ProtectFallback trigger={<span className="text-sm">{t('forbidden')}</span>} />
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Link
        href="/dashboard/moderation"
        className="rounded-lg border bg-card p-4 hover:bg-muted/30"
      >
        <div className="mb-1 flex items-center gap-2 font-medium">
          <Shield className="size-4" />
          {t('tools.moderation.title')}
        </div>
        <div className="text-sm text-muted-foreground">
          {t('tools.moderation.description')}
        </div>
      </Link>

      <Link
        href="/admin/doctor-verifications"
        className="rounded-lg border bg-card p-4 hover:bg-muted/30"
      >
        <div className="mb-1 flex items-center gap-2 font-medium">
          <Stethoscope className="size-4" />
          {t('tools.doctor_verifications.title')}
        </div>
        <div className="text-sm text-muted-foreground">
          {t('tools.doctor_verifications.description')}
        </div>
      </Link>

      <Link
        href="/admin/feature-requests"
        className="rounded-lg border bg-card p-4 hover:bg-muted/30"
      >
        <div className="mb-1 flex items-center gap-2 font-medium">
          <Lightbulb className="size-4" />
          {t('tools.feature_requests.title')}
        </div>
        <div className="text-sm text-muted-foreground">
          {t('tools.feature_requests.description')}
        </div>
      </Link>
    </div>
  );
}
