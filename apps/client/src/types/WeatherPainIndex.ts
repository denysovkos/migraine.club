import { z } from 'zod';

// WPI Level enum
export const WpiLevel = {
  LOW: 'low',
  MODERATE: 'moderate',
  HIGH: 'high',
  VERY_HIGH: 'very_high',
} as const;

export type WpiLevelType = typeof WpiLevel[keyof typeof WpiLevel];

// Weather data from OpenWeatherMap
export type IOpenWeatherMapData = {
  deltaPressure: number; // hPa difference max-min in the considered period
  temperatureDeviation: number; // avg (max-min) temperature deviation in °C
  humidity: number; // average daily humidity %
  windSpeed: number; // average daily wind speed (m/s)
  uvi: number; // current UV index
};

// Solar activity snapshot
export type SolarActivitySnapshot = {
  kpIndex: number; // 0–9
  timestampUtc: Date; // start of 3h Kp interval
  // Stored in `solar_activity_snapshot.source` (string in DB).
  // We keep a typed subset of values we write/read in the app.
  source: 'noaa' | 'noaa_now' | 'noaa_forecast' | 'gfz' | 'nasa' | 'kp_aggregate';
};

// Input for WPI computation
export type WpiInput = {
  deltaPressure: number; // hPa
  temperatureDeviation: number; // °C
  humidity: number; // %
  windSpeed: number; // m/s
  uvi: number; // UV index
  kpIndex: number | null; // 0–9 or null
};

// WPI component factors
export type WpiComponents = {
  pressureFactor: number;
  humidityFactor: number;
  tempFactor: number;
  windFactor: number;
  uviFactor: number;
  solarFactor: number;
};

// WPI computation result
export type WpiResult = {
  score: number; // 0.0–10.0
  level: WpiLevelType;
  components: WpiComponents;
};

// User weather settings validation schema
export const UserWeatherSettingsSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  locationLabel: z.string().max(200).optional(),
  timezone: z.string().min(1).max(100).default('UTC'),
  units: z.enum(['metric', 'imperial']).default('metric'),
});

export type UserWeatherSettingsInput = z.infer<typeof UserWeatherSettingsSchema>;

// User weather settings domain model
export type UserWeatherSettings = {
  id: string;
  userId: string;
  lat: number;
  lon: number;
  locationLabel: string | null;
  timezone: string;
  units: string;
  createdAt: Date;
  updatedAt: Date;
};

// Weather daily snapshot domain model
export type WeatherDailySnapshot = {
  id: string;
  lat: number;
  lon: number;
  date: Date;
  source: string;
  deltaPressure: number;
  temperatureDeviation: number;
  avgHumidity: number;
  avgWindSpeed: number;
  uvi: number;
  raw: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

// Solar activity snapshot domain model
export type SolarActivitySnapshotRecord = {
  id: string;
  timestampUtc: Date;
  kpIndex: number;
  source: string;
  raw: Record<string, unknown> | null;
  createdAt: Date;
};

// WPI snapshot domain model
export type WeatherPainIndexSnapshot = {
  id: string;
  userId: string;
  timestampLocal: Date;
  lat: number;
  lon: number;
  weatherSnapshotId: string | null;
  solarSnapshotId: string | null;
  wpiScore: number;
  wpiLevel: WpiLevelType;
  components: WpiComponents;
  createdAt: Date;
};

// API response types
export type CurrentWpiResponse = {
  timestamp: string;
  score: number;
  level: WpiLevelType;
  components: WpiComponents;
  weather: {
    deltaPressure: number;
    temperatureDeviation: number;
    humidity: number;
    windSpeed: number;
    uvi: number;
  };
  solar: {
    kpIndex: number | null;
    timestampUtc: string | null;
    source: string | null;
  };
};

export type WpiHistoryPoint = {
  timestamp: string;
  score: number;
  level: WpiLevelType;
  kpIndex: number | null;
};

export type WpiHistoryResponse = {
  points: WpiHistoryPoint[];
};
