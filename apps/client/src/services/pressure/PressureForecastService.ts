// The pressure outlook the Go server returns from /api/weather/pressure-outlook.
import type { PressureOutlookDay } from './pressureOutlook';

export type PressureOutlook = {
  timezone: string;
  /** User's alert threshold, null when alerts are off. */
  alertThresholdHpa: number | null;
  /** Threshold used to highlight drops (the alert threshold, or the default). */
  highlightThresholdHpa: number;
  days: PressureOutlookDay[];
};
