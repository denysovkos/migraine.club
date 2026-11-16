import '@/styles/global.css';

export const metadata = {
  title: 'Feature requests - Admin',
  robots: { index: false, follow: false },
};

export default function AdminFeatureRequestsLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {props.children}
      </body>
    </html>
  );
}
