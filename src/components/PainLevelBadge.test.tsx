import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import messages from '@/locales/en.json';

import { PainLevelBadge } from './PainLevelBadge';

describe('PainLevelBadge', () => {
  it('renders 5 as 5+', () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PainLevelBadge value={5} />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText('5+')).toBeInTheDocument();
  });

  it('normalizes legacy values (10 -> 5+)', () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PainLevelBadge value={10} />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText('5+')).toBeInTheDocument();
  });
});
