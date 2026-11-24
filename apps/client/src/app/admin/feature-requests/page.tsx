import Link from 'next/link';

import { adminGet } from '@/features/admin/adminApi';

import { AdminFeatureRequestActions } from '@/features/admin/AdminFeatureRequestActions';
import { requireUserOrRedirect } from '@/libs/AuthGuard';
import { AppConfig } from '@/utils/AppConfig';

type Request = { id: string; userId: string; title: string; description: string; resolution: string; createdAt: string; updatedAt: string };

const getResolutionLabelKey = (resolution: string) => {
  if (resolution === 'SENT') {
    return 'sent';
  }
  if (resolution === 'IN REVIEW') {
    return 'in_review';
  }
  if (resolution === 'ACCEPTED') {
    return 'accepted';
  }
  return 'rejected';
};

export default async function AdminFeatureRequestsPage() {
  // Admin routes are not localized; signed-out visitors go to the default-locale sign-in.
  await requireUserOrRedirect(AppConfig.defaultLocale);

  const res = await adminGet<{ requests: Request[] }>('/api/admin/feature-requests');
  if (res.status === 403) {
    return (
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="text-lg font-semibold">Forbidden</h1>
      </main>
    );
  }
  const requests = res.data!.requests;

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <Link href="/dashboard/admin" className="text-sm text-primary hover:underline">
          {'<- Back to admin'}
        </Link>
        <h1 className="mt-3 text-xl font-semibold">Feature requests</h1>
        <p className="text-sm text-muted-foreground">
          Community-submitted ideas and product feedback.
        </p>
      </div>

      <div className="space-y-3">
        {requests.length === 0 && (
          <div className="rounded-lg border p-4 text-sm text-muted-foreground">
            No feature requests yet.
          </div>
        )}

        {requests.map(request => (
          <div key={request.id} className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-medium">{request.title}</h2>
              <span className="rounded-full border px-2 py-1 text-xs">
                {getResolutionLabelKey(request.resolution).toUpperCase().replace('_', ' ')}
              </span>
            </div>

            <p className="text-sm text-muted-foreground">{request.description}</p>

            <div className="text-xs text-muted-foreground">
              User:
              {' '}
              {request.userId}
              {' · '}
              Submitted:
              {' '}
              {request.createdAt}
            </div>

            <AdminFeatureRequestActions
              requestId={request.id}
              currentResolution={request.resolution}
            />
          </div>
        ))}
      </div>
    </main>
  );
}
