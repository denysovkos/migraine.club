'use client';

import { useState } from 'react';

import { PressureAlertSettings } from './PressureAlertSettings';
import { WeatherSettingsForm } from './WeatherSettingsForm';

/** Location form plus the pressure-drop alert, which needs a saved location. */
export function LocationSettingsPanel() {
  const [savedCount, setSavedCount] = useState(0);

  return (
    <>
      <WeatherSettingsForm onSuccess={() => setSavedCount(n => n + 1)} />
      <PressureAlertSettings refreshKey={savedCount} />
    </>
  );
}
