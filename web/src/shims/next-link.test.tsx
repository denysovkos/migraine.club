import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import Link, { formatHref } from './next-link';

function Where() {
  const { pathname, search } = useLocation();
  return <output>{pathname + search}</output>;
}

function setup(element: React.ReactNode) {
  const page = (
    <>
      {element}
      <Where />
    </>
  );
  const router = createMemoryRouter([{ path: '*', element: page }], { initialEntries: ['/start'] });
  render(<RouterProvider router={router} />);
  return router;
}

afterEach(() => {
  document.cookie = 'NEXT_LOCALE=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

describe('formatHref', () => {
  it('passes strings through', () => {
    expect(formatHref('/a?b=1')).toBe('/a?b=1');
  });

  it('builds a URL object like next/link', () => {
    expect(formatHref({ pathname: '/a', query: { b: 1, c: ['x', 'y'], d: undefined }, hash: 'h' })).toBe('/a?b=1&c=x&c=y#h');
  });
});

describe('Link', () => {
  it('renders a plain anchor with the original href', () => {
    setup(<Link href="/dashboard" className="c">Go</Link>);

    const a = screen.getByRole('link', { name: 'Go' });

    expect(a).toHaveAttribute('href', '/dashboard');
    expect(a).toHaveClass('c', { exact: true });
  });

  it('navigates on the client through the locale rules', () => {
    document.cookie = 'NEXT_LOCALE=fr; path=/';
    setup(<Link href="/dashboard?tab=1">Go</Link>);

    fireEvent.click(screen.getByRole('link', { name: 'Go' }));

    expect(screen.getByRole('status')).toHaveTextContent('/fr/dashboard?tab=1');
  });

  it('lets modified clicks and external links reach the browser', () => {
    setup(
      <>
        <Link href="/dashboard">Internal</Link>
        <Link href="https://example.com">External</Link>
      </>,
    );

    fireEvent.click(screen.getByRole('link', { name: 'Internal' }), { metaKey: true });
    fireEvent.click(screen.getByRole('link', { name: 'External' }));

    expect(screen.getByRole('status')).toHaveTextContent('/start');
  });

  it('stays put when onNavigate prevents it', () => {
    setup(<Link href="/dashboard" onNavigate={e => e.preventDefault()}>Go</Link>);

    fireEvent.click(screen.getByRole('link', { name: 'Go' }));

    expect(screen.getByRole('status')).toHaveTextContent('/start');
  });
});
