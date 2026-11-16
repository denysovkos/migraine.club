import { describe, expect, it } from 'vitest';

import { subscribeSchema, unsubscribeSchema } from './validation';

describe('Push Subscribe Validation', () => {
  describe('subscribeSchema', () => {
    it('validates a correct subscription payload', () => {
      const validPayload = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
        keys: {
          p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=',
          auth: 'tBHItJI5svbpez7KI4CCXg==',
        },
        expirationTime: null,
      };

      const result = subscribeSchema.safeParse(validPayload);

      expect(result.success).toBe(true);
    });

    it('rejects payload with invalid endpoint URL', () => {
      const invalidPayload = {
        endpoint: 'not-a-url',
        keys: {
          p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=',
          auth: 'tBHItJI5svbpez7KI4CCXg==',
        },
      };

      const result = subscribeSchema.safeParse(invalidPayload);

      expect(result.success).toBe(false);

      if (!result.success) {
        expect(result.error.flatten().fieldErrors.endpoint).toBeDefined();
      }
    });

    it('rejects payload with missing p256dh key', () => {
      const invalidPayload = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
        keys: {
          p256dh: '',
          auth: 'tBHItJI5svbpez7KI4CCXg==',
        },
      };

      const result = subscribeSchema.safeParse(invalidPayload);

      expect(result.success).toBe(false);
    });

    it('rejects payload with missing auth key', () => {
      const invalidPayload = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
        keys: {
          p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=',
          auth: '',
        },
      };

      const result = subscribeSchema.safeParse(invalidPayload);

      expect(result.success).toBe(false);
    });

    it('rejects payload without keys object', () => {
      const invalidPayload = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      };

      const result = subscribeSchema.safeParse(invalidPayload);

      expect(result.success).toBe(false);
    });

    it('accepts payload with numeric expirationTime', () => {
      const validPayload = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
        keys: {
          p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=',
          auth: 'tBHItJI5svbpez7KI4CCXg==',
        },
        expirationTime: 1734105600000,
      };

      const result = subscribeSchema.safeParse(validPayload);

      expect(result.success).toBe(true);
    });

    it('accepts payload without expirationTime', () => {
      const validPayload = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
        keys: {
          p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=',
          auth: 'tBHItJI5svbpez7KI4CCXg==',
        },
      };

      const result = subscribeSchema.safeParse(validPayload);

      expect(result.success).toBe(true);
    });

    it('accepts various valid push endpoints', () => {
      const validEndpoints = [
        'https://fcm.googleapis.com/fcm/send/abc123',
        'https://updates.push.services.mozilla.com/wpush/v2/xyz',
        'https://wns2-par01.notify.windows.com/w/',
        'https://web.push.apple.com/QGuoy2TiYce',
      ];

      for (const endpoint of validEndpoints) {
        const result = subscribeSchema.safeParse({
          endpoint,
          keys: {
            p256dh: 'testkey',
            auth: 'testauth',
          },
        });

        expect(result.success).toBe(true);
      }
    });
  });
});

describe('Push Unsubscribe Validation', () => {
  describe('unsubscribeSchema', () => {
    it('validates a correct unsubscribe payload', () => {
      const validPayload = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      };

      const result = unsubscribeSchema.safeParse(validPayload);

      expect(result.success).toBe(true);
    });

    it('rejects payload with invalid endpoint', () => {
      const invalidPayload = {
        endpoint: 'not-a-valid-url',
      };

      const result = unsubscribeSchema.safeParse(invalidPayload);

      expect(result.success).toBe(false);
    });

    it('rejects empty payload', () => {
      const result = unsubscribeSchema.safeParse({});

      expect(result.success).toBe(false);
    });

    it('rejects missing endpoint', () => {
      const result = unsubscribeSchema.safeParse({ other: 'field' });

      expect(result.success).toBe(false);
    });
  });
});
