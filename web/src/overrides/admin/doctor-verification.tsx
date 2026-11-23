import Link from 'next/link';

import { AdminDoctorVerificationActions } from '@/features/doctorVerification/AdminDoctorVerificationActions';

import { adminGet } from './adminApi';

type Application = { id: string; fullName: string; country: string; specialty: string; verificationMethod: string; status: string; submittedAt: string | null; licenseNumber: string | null; clinicEmail: string | null; applicantStatementAccepted: boolean; file: { id: string; originalName: string } | null };

export default async function AdminDoctorVerificationDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  // src/app/admin/doctor-verifications/[id]/page.tsx, reading the
  // application and its document through the admin API.
  const { id } = await props.params;
  const res = await adminGet<{ application: Application }>(`/api/admin/doctor-verification/applications/${encodeURIComponent(id)}`);
  if (res.status === 403) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-lg font-semibold">Forbidden</h1>
      </main>
    );
  }
  const application = res.data?.application;
  const file = application?.file;

  if (!application) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <Link href="/admin/doctor-verifications" className="text-sm text-primary hover:underline">
          ← Back
        </Link>
        <h1 className="mt-4 text-lg font-semibold">Not found</h1>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <Link href="/admin/doctor-verifications" className="text-sm text-primary hover:underline">
          ← Back
        </Link>
        <h1 className="mt-3 text-xl font-semibold">{application.fullName}</h1>
        <div className="text-sm text-muted-foreground">
          {application.specialty}
          {' '}
          •
          {application.country}
          {' '}
          •
          {application.verificationMethod}
        </div>
      </div>

      <div className="space-y-2 rounded-lg border p-4 text-sm">
        <div>
          <span className="text-muted-foreground">Status:</span>
          {' '}
          {application.status}
        </div>
        <div>
          <span className="text-muted-foreground">Submitted:</span>
          {' '}
          {application.submittedAt ?? '—'}
        </div>
        <div>
          <span className="text-muted-foreground">Method:</span>
          {' '}
          {application.verificationMethod}
        </div>
        {application.licenseNumber && (
          <div>
            <span className="text-muted-foreground">License #:</span>
            {' '}
            {application.licenseNumber}
          </div>
        )}
        {application.clinicEmail && (
          <div>
            <span className="text-muted-foreground">Clinic email:</span>
            {' '}
            {application.clinicEmail}
          </div>
        )}
        <div>
          <span className="text-muted-foreground">Statement accepted:</span>
          {' '}
          {application.applicantStatementAccepted ? 'yes' : 'no'}
        </div>
        {file && (
          <div>
            <span className="text-muted-foreground">Document:</span>
            {' '}
            <a
              className="text-primary hover:underline"
              href={`/api/admin/doctor-verification/files/${file.id}`}
            >
              Download (
              {file.originalName}
              )
            </a>
          </div>
        )}
      </div>

      <AdminDoctorVerificationActions applicationId={application.id} />
    </main>
  );
}
