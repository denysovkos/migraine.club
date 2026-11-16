'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, MapPin, Navigation } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

const weatherSettingsSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  locationLabel: z.string().max(200).optional(),
  timezone: z.string().min(1).max(100),
  units: z.enum(['metric', 'imperial']),
});

type WeatherSettingsFormData = z.infer<typeof weatherSettingsSchema>;

type Props = {
  onSuccess?: () => void;
};

export function WeatherSettingsForm({ onSuccess }: Props) {
  const t = useTranslations('WeatherSettingsForm');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [geolocating, setGeolocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const form = useForm<WeatherSettingsFormData, any, WeatherSettingsFormData>({
    resolver: zodResolver(weatherSettingsSchema) as any,
    defaultValues: {
      lat: 0,
      lon: 0,
      locationLabel: '',
      timezone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
      units: 'metric',
    },
  });

  // Load existing settings
  useEffect(() => {
    async function loadSettings() {
      try {
        const response = await fetch('/api/user/weather-settings');
        if (response.ok) {
          const data = await response.json();
          form.reset({
            lat: data.lat,
            lon: data.lon,
            locationLabel: data.locationLabel || '',
            timezone: data.timezone || new Intl.DateTimeFormat().resolvedOptions().timeZone,
            units: data.units || 'metric',
          });
        }
      } catch {
        // Settings don't exist yet, that's fine
      } finally {
        setLoading(false);
      }
    }

    loadSettings();
  }, [form]);

  // Use browser geolocation
  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError(t('error_geolocation_unsupported'));
      return;
    }

    setGeolocating(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        form.setValue('lat', Math.round(latitude * 10000) / 10000);
        form.setValue('lon', Math.round(longitude * 10000) / 10000);

        // Try to reverse geocode to get location name
        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
          );
          if (response.ok) {
            const data = await response.json();
            const city = data.address?.city || data.address?.town || data.address?.village || '';
            const country = data.address?.country_code?.toUpperCase() || '';
            if (city || country) {
              form.setValue('locationLabel', city ? `${city}, ${country}` : country);
            }
          }
        } catch {
          // Reverse geocoding failed, that's okay
        }

        setGeolocating(false);
      },
      (err) => {
        setGeolocating(false);
        switch (err.code) {
          case err.PERMISSION_DENIED:
            setError(t('error_permission_denied'));
            break;
          case err.POSITION_UNAVAILABLE:
            setError(t('error_position_unavailable'));
            break;
          case err.TIMEOUT:
            setError(t('error_timeout'));
            break;
          default:
            setError(t('error_generic'));
        }
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 300000, // 5 minutes
      },
    );
  };

  const onSubmit = async (data: WeatherSettingsFormData) => {
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const response = await fetch('/api/user/weather-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save settings');
      }

      setSuccess(true);
      onSuccess?.();

      // Clear success message after 3 seconds
      setTimeout(setSuccess, 3000, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Use Current Location Button */}
        <div className="rounded-lg border border-dashed p-4">
          <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
              <Navigation className="size-6 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="font-medium">{t('use_current_location')}</h3>
              <p className="text-sm text-muted-foreground">
                {t('auto_detect_description')}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handleUseCurrentLocation}
              disabled={geolocating}
            >
              {geolocating
                ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      {t('detecting')}
                    </>
                  )
                : (
                    <>
                      <MapPin className="mr-2 size-4" />
                      {t('detect_location')}
                    </>
                  )}
            </Button>
          </div>
        </div>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">
              {t('or_enter_manually')}
            </span>
          </div>
        </div>

        {/* Location Label */}
        <FormField
          control={form.control}
          name="locationLabel"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('location_name_label')}</FormLabel>
              <FormControl>
                <Input placeholder={t('location_name_placeholder')} {...field} />
              </FormControl>
              <FormDescription>
                {t('location_name_description')}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Coordinates */}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="lat"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('latitude_label')}</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.0001"
                    min="-90"
                    max="90"
                    placeholder={t('latitude_placeholder')}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="lon"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('longitude_label')}</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.0001"
                    min="-180"
                    max="180"
                    placeholder={t('longitude_placeholder')}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Timezone */}
        <FormField
          control={form.control}
          name="timezone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('timezone_label')}</FormLabel>
              <FormControl>
                <Input placeholder={t('timezone_placeholder')} {...field} />
              </FormControl>
              <FormDescription>
                {t('timezone_description')}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Units */}
        <FormField
          control={form.control}
          name="units"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('units_label')}</FormLabel>
              <FormControl>
                <div className="flex gap-4">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      value="metric"
                      checked={field.value === 'metric'}
                      onChange={() => field.onChange('metric')}
                      className="size-4"
                    />
                    <span>{t('units_metric')}</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      value="imperial"
                      checked={field.value === 'imperial'}
                      onChange={() => field.onChange('imperial')}
                      className="size-4"
                    />
                    <span>{t('units_imperial')}</span>
                  </label>
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Error Message */}
        {error && (
          <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Success Message */}
        {success && (
          <div className="rounded-md bg-emerald-500/15 p-3 text-sm text-emerald-600 dark:text-emerald-400">
            {t('success_message')}
          </div>
        )}

        {/* Submit Button */}
        <Button type="submit" disabled={saving} className="w-full sm:w-auto">
          {saving
            ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  {t('saving')}
                </>
              )
            : (
                t('save_button')
              )}
        </Button>
      </form>
    </Form>
  );
}
