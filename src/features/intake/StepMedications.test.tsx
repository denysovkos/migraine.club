import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StepMedications } from './StepMedications';

const messages = {
  Intake: {
    step_medications_title: 'What do you take at the moment?',
    acute_label: 'For an attack',
    med_search_placeholder: 'Search medications',
    add_custom_med: 'Add "{name}"',
    med_search_error: 'Search failed. You can retry or add it below as free text.',
    med_search_retry: 'Retry search',
    remove_medication: 'Remove {name}',
    preventive_label: 'Taken regularly to prevent attacks',
    preventive_placeholder: 'Medication name',
    preventive_hint: 'Added as a daily plan.',
    remove_preventive: 'Remove {name}',
    add: 'Add',
  },
};

function renderStep(props: {
  acute: any[];
  preventive: any[];
  onChange: (next: any) => void;
}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <StepMedications {...props} />
    </NextIntlClientProvider>,
  );
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('StepMedications', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('picking a catalog result appends an entry carrying an identifier', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ kind: 'catalog', catalogMedicationId: 'cat-1', label: 'Sumatriptan' }] }),
    }));
    const onChange = vi.fn();
    renderStep({ acute: [], preventive: [], onChange });

    fireEvent.change(screen.getByPlaceholderText('Search medications'), { target: { value: 'sumatr' } });

    const hit = await screen.findByText('Sumatriptan');
    await userEvent.click(hit);

    expect(onChange).toHaveBeenCalledWith({
      acute: [{ catalogMedicationId: 'cat-1', customName: 'Sumatriptan' }],
      preventive: [],
    });
  });

  it('does not render an add-custom button for a whitespace-only term', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const onChange = vi.fn();
    renderStep({ acute: [], preventive: [], onChange });

    fireEvent.change(screen.getByPlaceholderText('Search medications'), { target: { value: '   ' } });

    expect(screen.queryByRole('button', { name: 'Add ""' })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('carries customName when adding a free-text medication', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) }));
    const onChange = vi.fn();
    renderStep({ acute: [], preventive: [], onChange });

    fireEvent.change(screen.getByPlaceholderText('Search medications'), { target: { value: 'Homemade Tea' } });

    const addButton = await screen.findByText('Add "Homemade Tea"');
    await userEvent.click(addButton);

    expect(onChange).toHaveBeenCalledWith({
      acute: [{ customName: 'Homemade Tea' }],
      preventive: [],
    });
  });

  it('removes an acute or preventive chip when its remove button is clicked', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const onChange = vi.fn();
    renderStep({
      acute: [{ customName: 'Sumatriptan' }, { customName: 'Ibuprofen' }],
      preventive: [{ name: 'Topiramate', kind: 'oral', scheduleType: 'daily', startDate: null }],
      onChange,
    });

    await userEvent.click(screen.getByRole('button', { name: 'Remove Sumatriptan' }));

    expect(onChange).toHaveBeenCalledWith({
      acute: [{ customName: 'Ibuprofen' }],
      preventive: [{ name: 'Topiramate', kind: 'oral', scheduleType: 'daily', startDate: null }],
    });

    await userEvent.click(screen.getByRole('button', { name: 'Remove Topiramate' }));

    expect(onChange).toHaveBeenLastCalledWith({
      acute: [{ customName: 'Sumatriptan' }, { customName: 'Ibuprofen' }],
      preventive: [],
    });
  });

  it('shows a search-failed message and still allows free text when the request errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const onChange = vi.fn();
    renderStep({ acute: [], preventive: [], onChange });

    fireEvent.change(screen.getByPlaceholderText('Search medications'), { target: { value: 'sumatr' } });

    await screen.findByText('Search failed. You can retry or add it below as free text.');

    expect(screen.getByText('Add "sumatr"')).toBeInTheDocument();
  });

  it('announces the search-failure banner to assistive tech', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const onChange = vi.fn();
    renderStep({ acute: [], preventive: [], onChange });

    fireEvent.change(screen.getByPlaceholderText('Search medications'), { target: { value: 'sumatr' } });

    const banner = await screen.findByRole('alert');

    expect(banner).toHaveTextContent('Search failed. You can retry or add it below as free text.');
  });

  it('does not let a stale search response overwrite newer results', async () => {
    const deferred1 = createDeferred<{ ok: boolean; json: () => Promise<any> }>();
    const deferred2 = createDeferred<{ ok: boolean; json: () => Promise<any> }>();
    const responses = [deferred1.promise, deferred2.promise];
    let callIndex = 0;
    const fetchMock = vi.fn(() => responses[callIndex++]);
    vi.stubGlobal('fetch', fetchMock);

    const onChange = vi.fn();
    renderStep({ acute: [], preventive: [], onChange });

    const input = screen.getByPlaceholderText('Search medications');

    fireEvent.change(input, { target: { value: 'abc' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.change(input, { target: { value: 'abcd' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // The newer (second) request resolves first, as it normally would.
    await act(async () => {
      deferred2.resolve({ ok: true, json: async () => ({ results: [{ kind: 'catalog', catalogMedicationId: 'r2', label: 'ResultTwo' }] }) });
      await Promise.resolve();
    });
    await screen.findByText('ResultTwo');

    // The slow, now-stale first request resolves afterwards and must not
    // overwrite the newer, already-displayed results.
    await act(async () => {
      deferred1.resolve({ ok: true, json: async () => ({ results: [{ kind: 'catalog', catalogMedicationId: 'r1', label: 'ResultOne' }] }) });
      await new Promise(resolve => setTimeout(resolve, 30));
    });

    expect(screen.queryByText('ResultOne')).not.toBeInTheDocument();
    expect(screen.getByText('ResultTwo')).toBeInTheDocument();
  });
});
