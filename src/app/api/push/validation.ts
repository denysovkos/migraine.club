import { z } from 'zod';

/**
 * Validation schema for push subscription
 */
export const subscribeSchema = z.object({
  endpoint: z.string().url('Invalid endpoint URL'),
  keys: z.object({
    p256dh: z.string().min(1, 'p256dh key is required'),
    auth: z.string().min(1, 'auth key is required'),
  }),
  expirationTime: z.number().nullable().optional(),
});

/**
 * Validation schema for unsubscribe request
 */
export const unsubscribeSchema = z.object({
  endpoint: z.string().url('Invalid endpoint URL'),
});

export type SubscribeInput = z.infer<typeof subscribeSchema>;
export type UnsubscribeInput = z.infer<typeof unsubscribeSchema>;
