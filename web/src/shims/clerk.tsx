// @clerk/nextjs in the SPA: Clerk's React SDK, with navigation going
// through react-router as @clerk/nextjs routed through the Next router.
import type { ComponentProps } from 'react';
import { ClerkProvider as ReactClerkProvider } from '@clerk/react';
import { useNavigate } from 'react-router';

// eslint-disable-next-line react-refresh/only-export-components
export * from '@clerk/react';

export function ClerkProvider(props: ComponentProps<typeof ReactClerkProvider>) {
  const navigate = useNavigate();
  return (
    <ReactClerkProvider
      routerPush={(to: string) => navigate(to)}
      routerReplace={(to: string) => navigate(to, { replace: true })}
      {...props}
    />
  );
}
