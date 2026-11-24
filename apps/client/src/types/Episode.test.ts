import { describe, expect, it } from 'vitest';

import {
  CreateEpisodeSchema,
  PainLocation,
  PainType,
  Symptom,
  Trigger,
} from './Episode';

describe('CreateEpisodeSchema', () => {
  it('should validate a valid episode', () => {
    const validEpisode = {
      intensity: 4,
      painLocation: PainLocation.FRONTAL,
      painType: PainType.THROBBING,
      symptoms: [Symptom.NAUSEA, Symptom.PHOTOPHOBIA],
      medications: [{ name: 'Ibuprofen', dose: '200mg' }],
      triggers: [Trigger.STRESS],
    };

    const result = CreateEpisodeSchema.safeParse(validEpisode);

    expect(result.success).toBe(true);
  });

  it('should reject invalid intensity (too high)', () => {
    const invalidEpisode = {
      intensity: 6,
      painLocation: PainLocation.FRONTAL,
      painType: PainType.THROBBING,
    };

    const result = CreateEpisodeSchema.safeParse(invalidEpisode);

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.issues[0]?.path).toContainEqual('intensity');
    }
  });

  it('should reject invalid intensity (negative)', () => {
    const invalidEpisode = {
      intensity: -1,
      painLocation: PainLocation.FRONTAL,
      painType: PainType.THROBBING,
    };

    const result = CreateEpisodeSchema.safeParse(invalidEpisode);

    expect(result.success).toBe(false);
  });

  it('should reject when endTime is before startTime', () => {
    const invalidEpisode = {
      startTime: '2024-01-01T12:00:00Z',
      endTime: '2024-01-01T11:00:00Z',
      intensity: 5,
      painLocation: PainLocation.FRONTAL,
      painType: PainType.THROBBING,
    };

    const result = CreateEpisodeSchema.safeParse(invalidEpisode);

    expect(result.success).toBe(false);

    if (!result.success) {
      const endTimeError = result.error.issues.find(
        issue => issue.path.includes('endTime'),
      );

      expect(endTimeError).toBeDefined();
    }
  });

  it('should accept when endTime equals startTime', () => {
    const validEpisode = {
      startTime: '2024-01-01T12:00:00Z',
      endTime: '2024-01-01T12:00:00Z',
      intensity: 5,
      painLocation: PainLocation.FRONTAL,
      painType: PainType.THROBBING,
    };

    const result = CreateEpisodeSchema.safeParse(validEpisode);

    expect(result.success).toBe(true);
  });

  it('should reject endTime when isOngoing is true', () => {
    const invalidEpisode = {
      startTime: '2024-01-01T12:00:00Z',
      endTime: '2024-01-01T13:00:00Z',
      isOngoing: true,
      intensity: 5,
      painLocation: PainLocation.FRONTAL,
      painType: PainType.THROBBING,
    };

    const result = CreateEpisodeSchema.safeParse(invalidEpisode);

    expect(result.success).toBe(false);

    if (!result.success) {
      const endTimeError = result.error.issues.find(
        issue => issue.path.includes('endTime'),
      );

      expect(endTimeError).toBeDefined();
    }
  });

  it('should accept isOngoing without endTime', () => {
    const validEpisode = {
      startTime: '2024-01-01T12:00:00Z',
      isOngoing: true,
      intensity: 5,
      painLocation: PainLocation.FRONTAL,
      painType: PainType.THROBBING,
    };

    const result = CreateEpisodeSchema.safeParse(validEpisode);

    expect(result.success).toBe(true);
  });

  it('should accept empty arrays for symptoms, medications, and triggers', () => {
    const validEpisode = {
      intensity: 5,
      painLocation: PainLocation.FRONTAL,
      painType: PainType.THROBBING,
      symptoms: [],
      triggers: [],
    };

    const result = CreateEpisodeSchema.safeParse(validEpisode);

    expect(result.success).toBe(true);
  });

  // Legacy episode.medications was removed from the create/update schemas.
});
