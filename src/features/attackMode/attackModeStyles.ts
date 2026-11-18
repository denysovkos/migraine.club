import { cn } from '@/utils/Helpers';

/*
 * Low-stimulus palette: near-black background, mid-grey text that still
 * meets WCAG AA (neutral-400 ≈ 8:1, neutral-500 ≈ 4.6:1 on black), no
 * colour accents, no motion. Kept independent of the app theme on purpose.
 */
export const bigButton = cn(
  'flex w-full flex-col items-center justify-center gap-1 rounded-3xl border border-neutral-800 bg-black px-4 text-center',
  'text-neutral-400 active:bg-neutral-950 disabled:cursor-not-allowed disabled:opacity-40',
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500',
);
export const bigLabel = 'text-2xl font-medium leading-tight';
export const bigSub = 'text-base text-neutral-500';
