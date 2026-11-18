import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dailyMock, pressureMock } = vi.hoisted(() => ({ dailyMock: vi.fn(), pressureMock: vi.fn() }));

vi.mock('@/services/DailyRiskAlertService', () => ({ dailyRiskAlertService: { processAlerts: dailyMock } }));
vi.mock('@/services/pressure/PressureAlertService', () => ({ pressureAlertService: { processAlerts: pressureMock } }));
vi.mock('@/app/api/cron/_shared/withCron', () => ({
  createCronRoute: (cfg: { run: (ctx: unknown) => Promise<unknown> }) => ({ POST: cfg.run, GET: cfg.run }),
}));

const { POST } = await import('./route');

beforeEach(() => {
  dailyMock.mockReset().mockResolvedValue({
    eligibleTimezones: [],
    usersProcessed: 1,
    sent: 1,
    skipped: 0,
    failed: 0,
    alreadyProcessed: 0,
    truncated: false,
    remaining: 0,
  });
  pressureMock.mockReset().mockResolvedValue({
    usersProcessed: 2,
    sent: 1,
    skipped: 1,
    failed: 0,
    alreadyProcessed: 0,
    truncated: false,
    remaining: 0,
    results: [],
  });
});

describe('daily-risk cron', () => {
  it('runs pressure-drop alerts after daily risk with the same deadline and reports both', async () => {
    const deadline = { remainingMs: () => 1000 };

    const summary = await (POST as unknown as (ctx: unknown) => Promise<Record<string, unknown>>)({ deadline, runId: 'r' });

    expect(dailyMock).toHaveBeenCalledWith(undefined, deadline);
    expect(pressureMock).toHaveBeenCalledWith(undefined, deadline);
    expect(summary).toMatchObject({
      sent: 1,
      pressure: { usersProcessed: 2, sent: 1, skipped: 1, failed: 0, alreadyProcessed: 0, truncated: false, remaining: 0 },
    });
  });
});
