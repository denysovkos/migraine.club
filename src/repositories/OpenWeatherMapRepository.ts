import type { IOpenWeatherMapData } from '@/types/WeatherPainIndex';
import axios from 'axios';

import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { logger } from '@/libs/Logger';
import { weatherDailySnapshotSchema } from '@/models/Schema';

// OpenWeatherMap API response types
type OWMCurrentResponse = {
  main: {
    temp: number;
    humidity: number;
    pressure: number;
    temp_min: number;
    temp_max: number;
  };
  wind: {
    speed: number;
  };
  uvi?: number;
};

type OWMOneCallResponse = {
  current: {
    temp: number;
    humidity: number;
    pressure: number;
    wind_speed: number;
    uvi: number;
  };
  hourly?: Array<{
    temp: number;
    humidity: number;
    pressure: number;
    wind_speed: number;
  }>;
  daily?: Array<{
    dt: number;
    temp: {
      min: number;
      max: number;
    };
    humidity: number;
    pressure: number;
    wind_speed: number;
    uvi: number;
  }>;
};

// Axios has no default timeout (0 = wait forever), so a stalled OpenWeatherMap
// connection would hang a cron run indefinitely. All calls go through this client.
const http = axios.create({
  timeout: Env.OPENWEATHERMAP_TIMEOUT_MS ?? 8000,
});

// Round coordinates to 2 decimal places for caching
function roundCoord(coord: number): number {
  return Math.round(coord * 100) / 100;
}

// Check if a snapshot is fresh (for today's data)
function isFreshForToday(snapshotDate: Date, createdAt: Date): boolean {
  const now = new Date();
  const snapshotDay = snapshotDate.toISOString().split('T')[0];
  const today = now.toISOString().split('T')[0];

  if (snapshotDay !== today) {
    return true; // Past days are always "fresh" (we can't get more data)
  }

  // For today, consider fresh if created within last 3 hours
  const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return createdAt > threeHoursAgo;
}

export class OpenWeatherMapRepository {
  private baseUrl = 'https://api.openweathermap.org/data/2.5';
  private oneCallUrl = 'https://api.openweathermap.org/data/3.0/onecall';

  private get apiKey(): string | undefined {
    return Env.OPENWEATHERMAP_API_KEY;
  }

  /**
   * Get current Air Quality Index (AQI)
   */
  async getAirPollutionAQI(lat: number, lon: number): Promise<number> {
    if (!this.apiKey) {
      logger.warn('OpenWeatherMap API key not configured');
      return 0;
    }

    try {
      const response = await http.get(`${this.baseUrl}/air_pollution`, {
        params: {
          lat,
          lon,
          appid: this.apiKey,
        },
      });

      return response.data.list?.[0]?.main?.aqi ?? 0;
    } catch (error) {
      logger.error({ error, lat, lon }, 'Failed to fetch air pollution data');
      return 0;
    }
  }

  /**
   * Get current weather data (original interface for backward compatibility)
   */
  async getWeather(lat: number, lon: number): Promise<IOpenWeatherMapData> {
    if (!this.apiKey) {
      logger.warn('OpenWeatherMap API key not configured');
      return this.getDefaultWeatherData();
    }

    try {
      // Use OneCall API for more comprehensive data
      const response = await http.get<OWMOneCallResponse>(this.oneCallUrl, {
        params: {
          lat,
          lon,
          appid: this.apiKey,
          units: 'metric',
          exclude: 'minutely,alerts',
        },
      });

      const data = response.data;
      const current = data.current;
      const hourly = data.hourly || [];

      // Calculate pressure delta from hourly data (max - min in last 24 hours)
      const pressures = hourly.slice(0, 24).map(h => h.pressure);
      const maxPressure = Math.max(...pressures, current.pressure);
      const minPressure = Math.min(...pressures, current.pressure);
      const deltaPressure = maxPressure - minPressure;

      // Calculate temperature deviation from hourly data
      const temps = hourly.slice(0, 24).map(h => h.temp);
      const maxTemp = Math.max(...temps, current.temp);
      const minTemp = Math.min(...temps, current.temp);
      const temperatureDeviation = maxTemp - minTemp;

      // Average humidity from hourly
      const avgHumidity = hourly.length > 0
        ? hourly.slice(0, 24).reduce((sum, h) => sum + h.humidity, 0) / Math.min(hourly.length, 24)
        : current.humidity;

      // Average wind speed
      const avgWindSpeed = hourly.length > 0
        ? hourly.slice(0, 24).reduce((sum, h) => sum + h.wind_speed, 0) / Math.min(hourly.length, 24)
        : current.wind_speed;

      return {
        deltaPressure,
        temperatureDeviation,
        humidity: avgHumidity,
        windSpeed: avgWindSpeed,
        uvi: current.uvi,
      };
    } catch (error) {
      // Fall back to basic current weather API
      logger.warn({ error }, 'OneCall API failed, falling back to current weather');
      return this.getBasicWeather(lat, lon);
    }
  }

  /**
   * Daily pressure forecast (OneCall `daily`, up to 8 days). Returns [] when the
   * API key is missing or the call fails, so callers can fall back to cache.
   */
  async getDailyPressureForecast(lat: number, lon: number): Promise<Array<{ dt: number; pressureHpa: number }>> {
    if (!this.apiKey) {
      logger.warn('OpenWeatherMap API key not configured');
      return [];
    }

    try {
      const response = await http.get<OWMOneCallResponse>(this.oneCallUrl, {
        params: {
          lat,
          lon,
          appid: this.apiKey,
          units: 'metric',
          exclude: 'current,minutely,hourly,alerts',
        },
      });

      return (response.data.daily ?? [])
        .filter(d => Number.isFinite(d.dt) && Number.isFinite(d.pressure))
        .map(d => ({ dt: d.dt, pressureHpa: d.pressure }));
    } catch (error) {
      logger.error({ error, lat, lon }, 'Failed to fetch daily pressure forecast');
      return [];
    }
  }

  /**
   * Get aggregated daily weather data with caching
   */
  async getAggregatedDaily(lat: number, lon: number, date: Date): Promise<IOpenWeatherMapData & { snapshotId: string | null }> {
    const roundedLat = roundCoord(lat);
    const roundedLon = roundCoord(lon);
    const dateOnly = new Date(date.toISOString().split('T')[0]!);

    // Check cache first
    const [cached] = await db
      .select()
      .from(weatherDailySnapshotSchema)
      .where(
        and(
          eq(weatherDailySnapshotSchema.lat, roundedLat),
          eq(weatherDailySnapshotSchema.lon, roundedLon),
          eq(weatherDailySnapshotSchema.date, dateOnly),
        ),
      )
      .limit(1);

    if (cached && isFreshForToday(cached.date, cached.createdAt)) {
      return {
        deltaPressure: cached.deltaPressure,
        temperatureDeviation: cached.temperatureDeviation,
        humidity: cached.avgHumidity,
        windSpeed: cached.avgWindSpeed,
        uvi: cached.uvi,
        snapshotId: cached.id,
      };
    }

    // Fetch fresh data
    const weatherData = await this.getWeather(roundedLat, roundedLon);

    // Upsert into database
    try {
      const [snapshot] = await db
        .insert(weatherDailySnapshotSchema)
        .values({
          lat: roundedLat,
          lon: roundedLon,
          date: dateOnly,
          source: 'openweathermap',
          deltaPressure: weatherData.deltaPressure,
          temperatureDeviation: weatherData.temperatureDeviation,
          avgHumidity: weatherData.humidity,
          avgWindSpeed: weatherData.windSpeed,
          uvi: weatherData.uvi,
          raw: null,
        })
        .onConflictDoUpdate({
          target: [
            weatherDailySnapshotSchema.lat,
            weatherDailySnapshotSchema.lon,
            weatherDailySnapshotSchema.date,
          ],
          set: {
            deltaPressure: weatherData.deltaPressure,
            temperatureDeviation: weatherData.temperatureDeviation,
            avgHumidity: weatherData.humidity,
            avgWindSpeed: weatherData.windSpeed,
            uvi: weatherData.uvi,
            updatedAt: new Date(),
          },
        })
        .returning();

      return {
        ...weatherData,
        snapshotId: snapshot?.id ?? null,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to upsert weather snapshot');
      return {
        ...weatherData,
        snapshotId: null,
      };
    }
  }

  /**
   * Fallback to basic weather API
   */
  private async getBasicWeather(lat: number, lon: number): Promise<IOpenWeatherMapData> {
    if (!this.apiKey) {
      return this.getDefaultWeatherData();
    }

    try {
      const response = await http.get<OWMCurrentResponse>(`${this.baseUrl}/weather`, {
        params: {
          lat,
          lon,
          appid: this.apiKey,
          units: 'metric',
        },
      });

      const data = response.data;
      return {
        deltaPressure: 0, // Can't calculate from single reading
        temperatureDeviation: data.main.temp_max - data.main.temp_min,
        humidity: data.main.humidity,
        windSpeed: data.wind.speed,
        uvi: data.uvi ?? 0,
      };
    } catch (error) {
      logger.error({ error, lat, lon }, 'Failed to fetch basic weather data');
      return this.getDefaultWeatherData();
    }
  }

  /**
   * Default weather data when API is unavailable
   */
  private getDefaultWeatherData(): IOpenWeatherMapData {
    return {
      deltaPressure: 0,
      temperatureDeviation: 0,
      humidity: 50,
      windSpeed: 0,
      uvi: 0,
    };
  }
}

// Singleton instance
export const openWeatherMapRepository = new OpenWeatherMapRepository();
