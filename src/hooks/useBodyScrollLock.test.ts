import { renderHook } from '@testing-library/react';

import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

describe('useBodyScrollLock', () => {
  it('freezes body scroll and restores original position', () => {
    const scrollTo = vi.fn();
    Object.defineProperty(window, 'scrollTo', { configurable: true, value: scrollTo });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 280 });
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 test',
    });

    const { unmount } = renderHook(() => useBodyScrollLock(true));

    expect(document.body).toHaveStyle({ position: 'fixed' });
    expect(document.body).toHaveStyle({ top: '-280px' });
    expect(document.body.dataset.modalOpen).toBe('true');

    unmount();

    expect(document.body).not.toHaveStyle({ position: 'fixed' });
    expect(document.body.dataset.modalOpen).toBeUndefined();
    expect(scrollTo).toHaveBeenCalledWith(0, 280);
  });
});
