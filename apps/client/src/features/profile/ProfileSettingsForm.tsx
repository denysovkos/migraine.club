'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { SupportedLanguages, ThemePreferences } from '@migraine/db/schema';
import { Globe, Loader2, MoonStar, User } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
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
import { useUserProfileContext } from '@/features/auth/UserProfileProvider';
import { useUserProfile } from '@/hooks/useUserProfile';
import { AppConfig } from '@/utils/AppConfig';
import { cn } from '@/utils/Helpers';

const profileSettingsSchema = z.object({
  displayName: z
    .string()
    .min(2, 'Display name must be at least 2 characters')
    .max(50, 'Display name must be at most 50 characters'),
  preferredLanguage: z.enum(SupportedLanguages),
  themePreference: z.enum(ThemePreferences),
});

type ProfileSettingsFormData = z.infer<typeof profileSettingsSchema>;

type Props = {
  onSuccess?: () => void;
};

export function ProfileSettingsForm({ onSuccess }: Props) {
  const t = useTranslations('ProfileSettings');
  const router = useRouter();
  const { setTheme } = useTheme();
  const { refetch, setThemePreferencePreview, themePreference } = useUserProfileContext();
  const { profile, loading, updateProfile } = useUserProfile();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const form = useForm<ProfileSettingsFormData>({
    resolver: zodResolver(profileSettingsSchema),
    defaultValues: {
      displayName: '',
      preferredLanguage: 'en',
      themePreference: 'light',
    },
  });

  // Load profile data into form
  useEffect(() => {
    if (profile) {
      form.reset({
        displayName: profile.displayName,
        preferredLanguage: profile.preferredLanguage,
        themePreference: profile.themePreference,
      });
    }
  }, [profile, form]);

  useEffect(() => {
    if (themePreference) {
      form.setValue('themePreference', themePreference);
    }
  }, [themePreference, form]);

  const onSubmit = async (data: ProfileSettingsFormData) => {
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const oldLanguage = profile?.preferredLanguage;
      const oldThemePreference = profile?.themePreference;
      const success = await updateProfile({
        displayName: data.displayName,
        preferredLanguage: data.preferredLanguage,
        themePreference: data.themePreference,
      });

      if (success) {
        if (oldThemePreference !== data.themePreference) {
          setTheme(data.themePreference);
          await refetch();
        }

        setSuccess(true);
        onSuccess?.();

        // If language changed, refresh the page to apply new locale
        if (oldLanguage !== data.preferredLanguage) {
          // Navigate to the same page with the new locale
          const currentPath = window.location.pathname;
          const pathParts = currentPath.split('/');

          // Check if current path has a locale prefix
          const currentLocale = pathParts[1];
          const supportedLocales = AppConfig.locales.map(l => l.id);

          if (supportedLocales.includes(currentLocale as string)) {
            // Replace the locale in the path
            pathParts[1] = data.preferredLanguage;
          } else {
            // Insert the new locale at position 1
            pathParts.splice(1, 0, data.preferredLanguage);
          }

          const newPath = pathParts.join('/');
          router.push(newPath);
          router.refresh();
        }

        // Clear success message after 3 seconds
        setTimeout(setSuccess, 3000, false);
      } else {
        if (oldThemePreference && oldThemePreference !== data.themePreference) {
          setTheme(oldThemePreference);
          setThemePreferencePreview(oldThemePreference);
          form.setValue('themePreference', oldThemePreference);
        }
        setError(t('error_save_failed'));
      }
    } catch (err) {
      const oldThemePreference = profile?.themePreference;
      if (oldThemePreference && oldThemePreference !== data.themePreference) {
        setTheme(oldThemePreference);
        setThemePreferencePreview(oldThemePreference);
        form.setValue('themePreference', oldThemePreference);
      }
      setError(err instanceof Error ? err.message : t('error_generic'));
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

  // Get localized language options
  const languageOptions = AppConfig.locales.map(locale => ({
    value: locale.id,
    label: locale.name,
    flag: locale.flag,
  }));

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Display Name */}
        <FormField
          control={form.control}
          name="displayName"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-2">
                <User className="size-4" />
                {t('display_name_label')}
              </FormLabel>
              <FormControl>
                <Input
                  placeholder={t('display_name_placeholder')}
                  className="text-base"
                  {...field}
                />
              </FormControl>
              <FormDescription>
                {t('display_name_description')}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Theme Preference */}
        <FormField
          control={form.control}
          name="themePreference"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-2">
                <MoonStar className="size-4" />
                {t('theme_label')}
              </FormLabel>
              <FormControl>
                <div className="grid grid-cols-2 gap-3 rounded-lg border bg-card p-3">
                  {ThemePreferences.map((option) => {
                    const isSelected = field.value === option;

                    return (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={isSelected}
                        className={cn(
                          'rounded-lg border px-4 py-3 text-sm font-medium transition-colors',
                          isSelected
                            ? 'border-primary bg-primary/10 text-foreground'
                            : 'border-border bg-background text-muted-foreground hover:bg-muted',
                        )}
                        onClick={() => {
                          field.onChange(option);
                          setThemePreferencePreview(option);
                          setTheme(option);
                        }}
                      >
                        {option === 'light' ? t('theme_light') : t('theme_dark')}
                      </button>
                    );
                  })}
                </div>
              </FormControl>
              <FormDescription>
                {t('theme_description')}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Preferred Language */}
        <FormField
          control={form.control}
          name="preferredLanguage"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-2">
                <Globe className="size-4" />
                {t('language_label')}
              </FormLabel>
              <FormControl>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-4">
                  {languageOptions.map(option => (
                    <label
                      key={option.value}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 transition-colors hover:bg-muted has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                    >
                      <input
                        type="radio"
                        value={option.value}
                        checked={field.value === option.value}
                        onChange={() => field.onChange(option.value)}
                        className="sr-only"
                      />
                      <span className="text-xl">{option.flag}</span>
                      <span className="text-sm font-medium">{option.label}</span>
                    </label>
                  ))}
                </div>
              </FormControl>
              <FormDescription>
                {t('language_description')}
              </FormDescription>
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
        <Button
          type="submit"
          disabled={saving}
          className="min-h-[44px] w-full sm:w-auto"
        >
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
