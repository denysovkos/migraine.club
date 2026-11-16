import '@/styles/global.css';

export const metadata = {
  title: 'Doctor verifications - Admin',
  robots: { index: false, follow: false },
};

export default function AdminDoctorVerificationsLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {props.children}
      </body>
    </html>
  );
}
