import type { WeatherContextData } from '@/models/Schema';
import { logger } from '@/libs/Logger';
import { weatherPainIndexService } from '@/services/WeatherPainIndexService';

export async function computeEpisodeWeatherContext(
  userId: string,
  startTime: Date,
): Promise<{ weatherPainIndexId: string | null; weatherContext: WeatherContextData | null }> {
  let weatherPainIndexId: string | null = null;
  let weatherContext: WeatherContextData | null = null;

  try {
    const settings = await weatherPainIndexService.getUserSettings(userId);
    if (settings) {
      const wpiData = await weatherPainIndexService.computeAndStoreForUser(
        userId,
        startTime,
      );

      weatherPainIndexId = wpiData.snapshotId;
      weatherContext = {
        wpiScore: wpiData.result.score,
        wpiLevel: wpiData.result.level,
        kpIndex: wpiData.kpIndex,
        deltaPressure: wpiData.weather.deltaPressure,
        temperatureDeviation: wpiData.weather.temperatureDeviation,
        humidity: wpiData.weather.humidity,
        windSpeed: wpiData.weather.windSpeed,
        uvi: wpiData.weather.uvi,
        components: wpiData.result.components,
      };
    }
  } catch (error) {
    // Log but don't fail episode creation
    logger.warn({ error, userId }, 'Failed to compute WPI for episode');
  }

  return { weatherPainIndexId, weatherContext };
}
