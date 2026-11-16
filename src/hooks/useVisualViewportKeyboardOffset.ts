'use client';

import { useEffect, useState } from 'react';

function readKeyboardOffset(): number {
  if (typeof window === 'undefined') {
    return 0;
  }

  const vv = window.visualViewport;
  if (!vv) {
    return 0;
  }

  return Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
}

export function useVisualViewportKeyboardOffset(active: boolean): number {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (!active) {
      setOffset(0);
      return;
    }

    const vv = window.visualViewport;
    if (!vv) {
      setOffset(0);
      return;
    }

    const sync = () => {
      setOffset(readKeyboardOffset());
    };

    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    window.addEventListener('resize', sync);

    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
      setOffset(0);
    };
  }, [active]);

  return offset;
}
