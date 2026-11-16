import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import messages from '@/locales/en.json';

import { PainLevelPicker } from './PainLevelPicker';

describe('PainLevelPicker', () => {
  it('calls onChange when a tile is tapped', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PainLevelPicker value={3} onChange={onChange} />
      </NextIntlClientProvider>,
    );

    await user.click(screen.getByRole('button', { name: /Pain level 4/i }));

    expect(onChange).toHaveBeenCalledWith(4);
  });

  it('marks the selected tile with aria-pressed', () => {
    const onChange = vi.fn();

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PainLevelPicker value={2} onChange={onChange} />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole('button', { name: /Pain level 2/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /Pain level 3/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});
