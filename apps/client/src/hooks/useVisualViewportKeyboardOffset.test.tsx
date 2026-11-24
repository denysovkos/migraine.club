import { act, renderHook } from '@testing-library/react';

import { useVisualViewportKeyboardOffset } from '@/hooks/useVisualViewportKeyboardOffset';

describe('useVisualViewportKeyboardOffset', () => {
  it('computes stable keyboard padding from visual viewport', () => {
    let onResize: (() => void) | null = null;
    let onScroll: (() => void) | null = null;

    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 900,
    });

    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        height: 620,
        offsetTop: 10,
        addEventListener: (name: string, fn: () => void) => {
          if (name === 'resize') {
            onResize = fn;
          }
          if (name === 'scroll') {
            onScroll = fn;
          }
        },
        removeEventListener: () => {},
      },
    });

    const { result } = renderHook(() => useVisualViewportKeyboardOffset(true));

    expect(result.current).toBe(270);

    (window.visualViewport as any).height = 650;
    act(() => {
      onResize?.();
      onScroll?.();
    });

    expect(result.current).toBe(240);
  });
});
