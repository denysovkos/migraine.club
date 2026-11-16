# Push Notifications Setup

This document describes how to set up Web Push notifications for Migrennity.

## Overview

Migrennity supports Web Push notifications for:
- Desktop browsers (Chrome, Firefox, Edge, Safari 16+)
- Android (Chrome, Firefox)
- iOS (Safari, when installed as PWA via "Add to Home Screen")

## Prerequisites

- HTTPS is required for push notifications (localhost works for development)
- Service Worker registered at `/sw.js`
- Valid VAPID keys

## VAPID Keys Setup

VAPID (Voluntary Application Server Identification) keys are required for secure push notifications.

### 1. Generate VAPID Keys

Install web-push globally (optional) or use npx:

```bash
npx web-push generate-vapid-keys
```

This outputs:

```
=======================================

Public Key:
BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM

Private Key:
Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM

=======================================
```

### 2. Configure Environment Variables

Add the following to your `.env.local` file:

```bash
# VAPID Keys for Web Push Notifications
# Generate with: npx web-push generate-vapid-keys

# Public key (shared with browser)
NEXT_PUBLIC_VAPID_PUBLIC_KEY=your-public-key-here

# Private key (server-side only, KEEP SECRET!)
VAPID_PRIVATE_KEY=your-private-key-here

# Subject - must be mailto: or https://
# Use mailto: with your contact email or your app URL
VAPID_SUBJECT=mailto:hello@migraine.club
```

**Important:**
- The public key is safe to expose (it's sent to the browser)
- The private key must be kept secret (server-side only)
- The subject identifies your application to push services

### 3. Production Deployment

For production deployments (Vercel, Railway, etc.):

1. Add the environment variables to your deployment platform
2. Ensure `VAPID_PRIVATE_KEY` is marked as "Secret" or "Sensitive"
3. `NEXT_PUBLIC_VAPID_PUBLIC_KEY` should be prefixed with `NEXT_PUBLIC_` to be available client-side

## Database Migration

The push subscription table will be created automatically on first run. The migration file is at:

```
migrations/0008_push_subscriptions.sql
```

## How It Works

### 1. User Enables Notifications

1. User goes to Settings → Notifications
2. User clicks "Enable notifications"
3. Browser requests notification permission
4. If granted, browser creates a push subscription via Service Worker
5. Subscription is sent to `/api/push/subscribe` and stored in the database

### 2. Sending Notifications

Notifications are sent via the `pushService`:

```typescript
import { pushService } from '@/server/push/push.service';

// Send to a specific user (all their devices)
await pushService.sendToUser(userId, {
  title: 'Weather Alert',
  body: 'High migraine risk expected today',
  icon: '/android-chrome-192x192.png',
  url: '/dashboard',
});
```

### 3. Handling Stale Subscriptions

When a push notification fails with 404 or 410 status, the subscription is automatically removed from the database. This handles:
- User uninstalling the PWA
- Expired subscriptions
- Browser clearing data

## API Routes

### POST /api/push/subscribe
Subscribe the current user's device to push notifications.

Request body:
```json
{
  "endpoint": "https://fcm.googleapis.com/...",
  "keys": {
    "p256dh": "base64-encoded-key",
    "auth": "base64-encoded-key"
  },
  "expirationTime": null
}
```

### POST /api/push/unsubscribe
Unsubscribe a specific endpoint.

Request body:
```json
{
  "endpoint": "https://fcm.googleapis.com/..."
}
```

### POST /api/push/test
Send a test notification to all of the current user's subscribed devices.

## iOS Support

Push notifications on iOS require:
1. iOS 16.4 or later
2. Safari browser
3. App installed as PWA (Add to Home Screen)

The notification settings page shows guidance for iOS users who haven't installed the PWA.

## Troubleshooting

### "Push notifications not configured"
- Check that VAPID keys are set in environment variables
- Ensure `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is prefixed correctly

### "Notifications blocked"
- User has denied permission in browser settings
- User needs to manually allow notifications in browser settings

### Test notification not received
- Check browser console for errors
- Verify Service Worker is registered (`navigator.serviceWorker.controller`)
- Check that the subscription was saved (database or API logs)

### iOS notifications not working
- Ensure user has installed the app via "Add to Home Screen"
- iOS 16.4+ is required
- Safari is required (not Chrome on iOS)

## Daily Risk Alerts (Cron)

Migrennity can send daily risk alerts during the day (local time) when weather or upcoming solar conditions indicate elevated migraine risk.

### How It Works

1. A cron job runs every 4 hours
2. For each run, it loads fresh solar data and reads the latest GFZ payload (which contains future Kp values)
3. For each user with alerts enabled, it checks if the user's local time is within 09:00–19:59
4. If WPI ≥ 5.0 (high) and/or the **max future Kp** ≥ 5 (storm level), a grouped notification is sent
5. Deduplication ensures at most one alert per user per day

### Setup

1. Add the `CRON_SECRET` environment variable:

```bash
# Generate a secure secret
openssl rand -base64 32

# Add to .env.local
CRON_SECRET=your-generated-secret-here
```

2. For Vercel deployment, the cron is configured in `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/daily-risk",
      "schedule": "0 */4 * * *"
    }
  ]
}
```

Note: Vercel automatically adds the `x-cron-secret` header to cron requests.

3. For local testing, run manually:

```bash
curl -X POST \
  -H "x-cron-secret: $CRON_SECRET" \
  http://localhost:3000/api/cron/daily-risk
```

### User Settings

Users can enable/disable daily risk alerts in Settings → Notifications. Alerts require:
- Push notifications enabled
- Location configured in Weather Settings

### Database Tables

- `risk_alert_run` - Tracks sent alerts for deduplication
- `user_weather_settings.alerts_enabled` - User preference

## Security Considerations

1. **Authentication**: All push API routes require Clerk authentication
2. **Cron Security**: Cron endpoint requires `x-cron-secret` header
3. **Endpoint Uniqueness**: Subscriptions are stored with unique endpoints
4. **User Isolation**: Users can only manage their own subscriptions
5. **VAPID Security**: Private key is server-side only
6. **Cleanup**: Stale subscriptions are automatically removed
