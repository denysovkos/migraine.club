'use client';

import { Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useState } from 'react';

import { Switch } from '@/components/ui/switch';
import { useUserProfileContext } from '@/features/auth/UserProfileProvider';

export function ThemeToggleButton() {
  const t = useTranslations('ProfileSettings');
  const { themePreference, updateThemePreference } = useUserProfileContext();
  const { setTheme } = useTheme();
  const [saving, setSaving] = useState(false);

  if (!themePreference) {
    return null;
  }

  const handleCheckedChange = async (checked: boolean) => {
    const nextTheme = checked ? 'dark' : 'light';
    setTheme(nextTheme);
    setSaving(true);
    const saved = await updateThemePreference(nextTheme);
    setSaving(false);

    if (!saved) {
      setTheme(themePreference);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Sun className="size-4 text-muted-foreground" />
      <Switch
        aria-label={t('theme_toggle_label')}
        checked={themePreference === 'dark'}
        disabled={saving}
        onCheckedChange={handleCheckedChange}
      />
      <Moon className="size-4 text-muted-foreground" />
    </div>
  );
}
