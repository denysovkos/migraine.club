'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/utils/Helpers';

type ActiveLinkProps = {
  href: string;
  children: React.ReactNode;
  /**
   * When true, the link is only active when the pathname exactly matches the href.
   * When false (default), the link is active when the pathname starts with the href.
   */
  exact?: boolean;
  className?: string;
};

export const ActiveLink = ({ href, children, exact = false, className }: ActiveLinkProps) => {
  const pathname = usePathname();

  // Remove locale prefix from pathname for comparison
  // Pattern: /locale/path or /path
  const normalizedPathname = pathname.replace(/^\/[a-z]{2}(?=\/|$)/, '') || '/';

  const isActive = exact
    ? normalizedPathname === href || pathname.endsWith(href)
    : normalizedPathname.startsWith(href) || pathname.includes(href);

  return (
    <Link
      href={href}
      className={cn(
        'block w-full px-3 py-2',
        isActive && 'rounded-md bg-primary text-primary-foreground',
        className,
      )}
    >
      {children}
    </Link>
  );
};
