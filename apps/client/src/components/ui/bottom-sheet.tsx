'use client';

import { useEffect } from 'react';

import { cn } from '@/utils/Helpers';

export function BottomSheet(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  maxHeightClassName?: string;
}) {
  const { open, onOpenChange, title, children, maxHeightClassName } = props;

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onOpenChange(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        className="absolute inset-0 bg-black/30"
        aria-label="Close"
        onClick={() => onOpenChange(false)}
      />

      <div
        className={cn(
          // Mobile: bottom sheet. Desktop (md+): centered modal.
          'absolute inset-x-0 bottom-0 mx-auto w-full max-w-screen-sm max-w-[100vw] rounded-t-2xl border bg-card shadow-xl',
          'md:bottom-auto md:top-1/2 md:max-w-lg md:-translate-y-1/2 md:rounded-2xl',
        )}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="min-h-11 min-w-0 flex-1 break-words text-base font-semibold">
            {title}
          </div>
          <button
            type="button"
            className="min-h-11 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div
          className={cn(
            'px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3',
            maxHeightClassName ?? 'max-h-[70vh] overflow-y-auto md:max-h-[75vh]',
            // Sheets should never scroll horizontally; horizontal overflow must be fixed at the source.
            'overflow-x-hidden',
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
