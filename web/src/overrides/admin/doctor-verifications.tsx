import Link from 'next/link';

import { adminGet } from './adminApi';

type Row = { id: string; fullName: string; country: string; specialty: string; verificationMethod: string; submittedAt: string | null; status: string };

export default async function AdminDoctorVerificationsPage() {
  // src/app/admin/doctor-verifications/page.tsx, reading the pending
  // submitted applications through the admin API.
  const res = await adminGet<{ applications: Row[] }>('/api/admin/doctor-verification/applications?status=pending');
  if (res.status === 403) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-lg font-semibold">Forbidden</h1>
      </main>
    );
  }
  const pending = res.data!.applications;

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
                {app.submittedAt ?? ''}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
