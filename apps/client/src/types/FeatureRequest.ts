import { FeatureRequestResolution } from '@migraine/db/schema';

import { z } from 'zod';

export const FeatureRequestResolutionSchema = z.union([
  z.literal(FeatureRequestResolution.SENT),
  z.literal(FeatureRequestResolution.IN_REVIEW),
  z.literal(FeatureRequestResolution.ACCEPTED),
  z.literal(FeatureRequestResolution.REJECTED),
]);

export const CreateFeatureRequestSchema = z.object({
  title: z.string().trim().min(3).max(140),
  description: z.string().trim().min(10).max(4000),
});

export type CreateFeatureRequestInput = z.infer<typeof CreateFeatureRequestSchema>;

export const UpdateFeatureRequestResolutionSchema = z.object({
  requestId: z.string().guid(),
  resolution: FeatureRequestResolutionSchema,
});

export type UpdateFeatureRequestResolutionInput = z.infer<
  typeof UpdateFeatureRequestResolutionSchema
>;
