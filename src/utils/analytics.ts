type UmamiApi = {
  track?: (event: string, data?: Record<string, any>) => void;
  trackEvent?: (event: string, data?: Record<string, any>) => void;
};

export function trackEvent(event: string, data?: Record<string, any>): void {
  if (typeof window === 'undefined') {
    return;
  }
  const umami = (window as any).umami as UmamiApi | undefined;
  if (!umami) {
    return;
  }
  if (typeof umami.track === 'function') {
    umami.track(event, data);
    return;
  }
  if (typeof umami.trackEvent === 'function') {
    umami.trackEvent(event, data);
  }
}
