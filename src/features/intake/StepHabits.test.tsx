import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import { StepHabits } from './StepHabits';

const messages = {
  Intake: {
    step_habits_title: 'Two quick habits',
    sleep_trouble_label: 'Trouble sleeping?',
    sleep_often: 'Often',
    sleep_sometimes: 'Sometimes',
    sleep_rarely: 'Rarely',
    bed_label: 'Usual bed time',
    wake_label: 'Usual wake time',
    med_timing_label: 'How soon after onset do you take acute medication?',
    timing_lt30: 'Within 30 minutes',
    timing_30_120: '30 minutes to 2 hours',
    timing_gt120: 'More than 2 hours',
    timing_varies: 'It varies',
  },
};

function renderHabits(props: any) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <StepHabits {...props} />
    </NextIntlClientProvider>,
  );
}

describe('StepHabits', () => {
  it('reports the selected sleep-trouble value', async () => {
    const onChange = vi.fn();
    renderHabits({
      value: { sleepTrouble: null, typicalBed: null, typicalWake: null, medTiming: null },
      onChange,
    });

    await userEvent.click(screen.getByText('Often'));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sleepTrouble: 'often' }));
  });

  it('reports the selected medication-timing band', async () => {
    const onChange = vi.fn();
    renderHabits({
      value: { sleepTrouble: 'often', typicalBed: null, typicalWake: null, medTiming: null },
      onChange,
    });

    await userEvent.click(screen.getByText('More than 2 hours'));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ medTiming: 'gt120' }));
  });
});
