import { and, desc, eq, isNotNull } from 'drizzle-orm';
import Link from 'next/link';

import { requireUserOrRedirect } from '@/libs/AuthGuard';
import { db } from '@/libs/DB';
import { doctorVerificationApplicationSchema } from '@/models/Schema';
import { moderationService } from '@/services/ModerationService';
import { AppConfig } from '@/utils/AppConfig';

export default async function AdminDoctorVerificationsPage() {
  // Admin routes are not localized; signed-out visitors go to the default-locale sign-in.
  const userId = await requireUserOrRedirect(AppConfig.defaultLocale);

  const isAdmin = await moderationService.isAdmin(userId);
  if (!isAdmin) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-lg font-semibold">Forbidden</h1>
      </main>
    );
  }

  const pending = await db
    .select({
      id: doctorVerificationApplicationSchema.id,
      fullName: doctorVerificationApplicationSchema.fullName,
      country: doctorVerificationApplicationSchema.country,
      specialty: doctorVerificationApplicationSchema.specialty,
      verificationMethod: doctorVerificationApplicationSchema.verificationMethod,
      submittedAt: doctorVerificationApplicationSchema.submittedAt,
      status: doctorVerificationApplicationSchema.status,
    })
    .from(doctorVerificationApplicationSchema)
    .where(
      and(
        eq(doctorVerificationApplicationSchema.status, 'pending' as any),
        isNotNull(doctorVerificationApplicationSchema.submittedAt),
      ),
    )
    .orderBy(desc(doctorVerificationApplicationSchema.submittedAt));

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Doctor verifications</h1>
        <p className="text-sm text-muted-foreground">
          Manual review queue (privacy: doctors never get patient access without share links).
        </p>
      </div>

      <div className="space-y-3">
        {pending.length === 0 && (
          <div className="rounded-lg border p-4 text-sm text-muted-foreground">
            No pending applications.
          </div>
        )}

        {pending.map(app => (
          <Link
            key={app.id}
            href={`/admin/doctor-verifications/${app.id}`}
            className="block rounded-lg border p-4 hover:bg-muted/30"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">{app.fullName}</div>
                <div className="text-sm text-muted-foreground">
                  {app.specialty}
                  {' '}
                  •
                  {app.country}
                  {' '}
                  •
                  {app.verificationMethod}
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                {app.submittedAt ? app.submittedAt.toISOString() : ''}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
