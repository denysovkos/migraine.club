import { render, screen } from '@testing-library/react';
import { use } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary, settled } from './routes';
import { notFound, redirect } from './shims/next-navigation';

vi.mock('./NotFoundPage', () => ({ NotFoundPage: () => <h1>404</h1> }));

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

  it('rethrows anything else', async () => {
    const Boom = () => {
      throw new Error('boom');
    };
    const router = createMemoryRouter([{
      path: '/',
      ErrorBoundary: () => <p>outer</p>,
      children: [{ index: true, Component: Boom, ErrorBoundary }],
    }]);
    render(<RouterProvider router={router} />);

    expect(await screen.findByText('outer')).toBeInTheDocument();
  });
});
