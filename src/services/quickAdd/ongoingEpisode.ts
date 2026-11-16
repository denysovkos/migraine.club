export type EpisodeRow = {
  id: number;
  isOngoing: boolean;
  startTime: Date;
};

export function pickOngoingEpisodeId(episodes: EpisodeRow[]): number | null {
  const ongoing = episodes.filter(e => e.isOngoing);
  if (ongoing.length === 0) {
    return null;
  }
  ongoing.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
  return ongoing[0]!.id;
}
