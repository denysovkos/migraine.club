import { render, screen } from '@testing-library/react';
import { use } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { errorBoundary, routes, settled } from './routes';
import { notFound, redirect } from './shims/next-navigation';

vi.mock('./NotFoundPage', () => ({ NotFoundPage: () => <h1>404</h1> }));

const captureException = vi.hoisted(() => vi.fn());
vi.mock('@sentry/react', () => ({ captureException }));

const ErrorBoundary = errorBoundary('fr');

function Where() {
  return <output>{useLocation().pathname}</output>;
}

function setup(Page: () => React.ReactNode) {
  const router = createMemoryRouter([
    { path: '/start', Component: Page, ErrorBoundary },
    { path: '*', Component: Where },
  ], { initialEntries: ['/start'] });
  render(<RouterProvider router={router} />);
}

describe('settled', () => {
  it('is read by use() without suspending', () => {
    function Page() {
      return <p>{use(settled({ id: 'x' })).id}</p>;
    }
    setup(Page);

    expect(screen.getByText('x')).toBeInTheDocument();
  });
});

describe('ErrorBoundary', () => {
  // React reports every error a boundary catches on console.error.
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('follows a redirect() thrown while a client page renders', async () => {
    setup(() => redirect('/dashboard/settings/profile'));

    expect(await screen.findByRole('status')).toHaveTextContent('/dashboard/settings/profile');
  });

  it('renders the 404 page for notFound()', async () => {
    setup(() => notFound());

    expect(await screen.findByRole('heading', { name: '404' })).toBeInTheDocument();
  });

  it('reports anything else to Sentry and shows the global error page', async () => {
    const boom = new Error('boom');
    setup(() => {
      throw boom;
    });

    expect(await screen.findByRole('heading', { level: 2 })).toHaveTextContent('Application error: a client-side exception has occurred (see the browser console for more information).');
    expect(captureException).toHaveBeenCalledWith(boom);
    expect(document.documentElement).toHaveAttribute('lang', 'fr');
    expect(document.title).toBe('');
  });
});

describe('routes', () => {
  it('answers a URL no page matches with the bare 404, outside the locale layout', async () => {
    const router = createMemoryRouter(routes(), { initialEntries: ['/uk/no-such-page'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: '404' })).toBeInTheDocument();
    expect(router.state.matches.map(m => m.route.path)).toEqual(['*']);
  });

  // Pages outside [locale] (share links, admin) are found by a glob relative
  // to this directory; a wrong path leaves those trees empty and every such
  // URL falls through to the 404.
  it('builds the pages outside the locale tree', () => {
    const top = routes().find(r => r.path === '/share');

    expect(top?.children?.map(c => c.path)).toContain(':token');
  });
});
