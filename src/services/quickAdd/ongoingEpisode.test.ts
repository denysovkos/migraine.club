import { pickOngoingEpisodeId } from '@/services/quickAdd/ongoingEpisode';

describe('pickOngoingEpisodeId', () => {
  it('returns null when there is no ongoing episode', () => {
    expect(pickOngoingEpisodeId([
      { id: 1, isOngoing: false, startTime: new Date('2025-01-01T00:00:00Z') },
    ])).toBeNull();
  });

  it('picks the most recent ongoing episode', () => {
    expect(pickOngoingEpisodeId([
      { id: 1, isOngoing: true, startTime: new Date('2025-01-01T00:00:00Z') },
      { id: 2, isOngoing: true, startTime: new Date('2025-01-02T00:00:00Z') },
      { id: 3, isOngoing: false, startTime: new Date('2025-01-03T00:00:00Z') },
    ])).toBe(2);
  });
});
