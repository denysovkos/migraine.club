'use client';

import { hideSnackbar, useSnackbarState } from '@/features/snackbar/snackbarStore';
import { cn } from '@/utils/Helpers';

export function SnackbarViewport() {
  const s = useSnackbarState();

  if (!s.open) {
    return null;
  }

  return (
    <div
      className={cn(
        'fixed inset-x-0 bottom-0 z-50 px-3 pb-[max(12px,env(safe-area-inset-bottom))]',
      )}
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex w-full max-w-screen-sm items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 shadow-lg">
        <div className="min-w-0 text-sm">
          <div className="truncate font-medium">{s.message}</div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {s.actions.map((a) => {
            return (
              <button
                type="button"
                key={a.label}
                className="min-h-11 rounded-md px-3 text-sm font-medium text-primary hover:bg-muted"
                onClick={async () => {
                  await a.onClick();
                  hideSnackbar();
                }}
              >
                {a.label}
              </button>
            );
          })}

          <button
            type="button"
            className="min-h-11 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted"
            onClick={hideSnackbar}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
