/**
 * Every page of the app with concrete parameters, for the visual parity
 * harness. Dynamic segments point at the rows FIXTURES creates.
 */
export const IDS = {
  episode: 970501,
  post: 'aaaaaaaa-0000-4000-8000-000000000001',
  plan: 'aaaaaaaa-0000-4000-8000-000000000002',
  prep: 'aaaaaaaa-0000-4000-8000-000000000003',
  application: 'aaaaaaaa-0000-4000-8000-000000000004',
  shareToken: 'visual-parity-token',
};

const U = `'e2e_user_test_001'`;

export const FIXTURES = [
  `UPDATE "user" SET role = 'admin' WHERE id = ${U}`,
  `INSERT INTO episode (id, user_id, attack_type, start_time, end_time, intensity, pain_location, pain_type, notes)
    VALUES (${IDS.episode}, ${U}, 'migraine', now() - interval '3 day', now() - interval '3 day' + interval '5 hour', 4, 'LEFT', 'THROBBING', 'Visual parity attack')
    ON CONFLICT (id) DO NOTHING`,
  `INSERT INTO community_post (id, author_id, title, body, tags, is_anonymous, score, visibility)
    VALUES ('${IDS.post}', ${U}, 'Visual parity post', 'A post body for the screenshots.', 'sleep', false, 2, 'PUBLIC') ON CONFLICT (id) DO NOTHING`,
  `INSERT INTO preventive_plan (id, user_id, name, kind, dose_text, schedule_type, schedule_payload, start_date, reminder_times, reminders_enabled)
    VALUES ('${IDS.plan}', ${U}, 'Topiramate', 'oral', '25 mg', 'daily', '{}', CURRENT_DATE - 45, '["08:00"]', true) ON CONFLICT (id) DO NOTHING`,
  `INSERT INTO appointment_prep (id, user_id, appointment_date, visit_label, top_concerns, doctor_questions, compare_window_days, generated_snapshot)
    VALUES ('${IDS.prep}', ${U}, CURRENT_DATE + 7, 'Neurology follow-up', '["Frequency"]', '["Should I switch?"]', 90, '{"compareWindowDays":90,"coverage":{"totalDays":90,"recordedDays":30,"missingDays":60},"attackStats":{"totalAttacks":1,"avgIntensity":4},"currentSnapshot":{"headacheBurden":{"migraineDays":1,"headacheDays":1},"acuteMedicationDays":0,"preventiveNames":["Topiramate"],"questionnaireScores":{"hit6":null,"midas":null}},"whatChangedKeys":[],"questionPromptKeys":[]}') ON CONFLICT (id) DO UPDATE SET generated_snapshot = EXCLUDED.generated_snapshot`,
  `INSERT INTO doctor_verification_application (id, user_id, status, full_name, country, specialty, verification_method, submitted_at)
    VALUES ('${IDS.application}', 'e2e_visual_doctor', 'pending', 'Dr Visual', 'DE', 'neurologist', 'license_number', now() - interval '1 day')
    ON CONFLICT (id) DO NOTHING`,
  `INSERT INTO doctor_share_link (user_id, token, expires_at) VALUES (${U}, '${IDS.shareToken}', now() + interval '7 day') ON CONFLICT DO NOTHING`,
];

const localized = [
  '/',
  '/community',
  '/dashboard',
  '/dashboard/admin',
  '/dashboard/community',
  `/dashboard/community/${IDS.post}`,
  '/dashboard/community/new',
  '/dashboard/cycle',
  '/dashboard/diary',
  '/dashboard/episodes',
  `/dashboard/episodes/${IDS.episode}`,
  '/dashboard/episodes/new',
  '/dashboard/insights',
  '/dashboard/insights/report',
  '/dashboard/moderation',
  '/dashboard/outcomes',
  '/dashboard/outcomes/acute-meds',
  '/dashboard/programs',
  '/dashboard/programs/sleep-regularity',
  '/dashboard/programs/sleep-regularity/progress',
  '/dashboard/questionnaires',
  '/dashboard/reports',
  '/dashboard/reports/appointment-prep',
  `/dashboard/reports/appointment-prep/${IDS.prep}`,
  '/dashboard/reports/clinician',
  '/dashboard/settings',
  '/dashboard/settings/account',
  '/dashboard/settings/cycle',
  '/dashboard/settings/doctor-verification',
  '/dashboard/settings/help',
  '/dashboard/settings/location',
  '/dashboard/settings/medications',
  '/dashboard/settings/modules',
  '/dashboard/settings/notifications',
  '/dashboard/settings/privacy',
  '/dashboard/settings/profile',
  '/dashboard/settings/programs',
  '/dashboard/settings/treatments',
  `/dashboard/settings/treatments/${IDS.plan}`,
  '/dashboard/share',
  '/dashboard/user-profile',
  '/dashboard/weather-settings',
  '/help/install-notifications',
  '/install',
  '/mcp',
  '/onboarding',
  '/privacy',
  '/product',
  '/quick/attack',
  '/quick/sleep',
  '/reports',
  '/reports/clinician',
  '/sign-in',
  '/sign-up',
  '/terms',
  // notFound() thrown by the page (the id is not a number).
  '/dashboard/episodes/not-a-number',
];

/** Routes outside the locale tree. */
const plain = [
  '/admin/doctor-verifications',
  `/admin/doctor-verifications/${IDS.application}`,
  '/admin/feature-requests',
  `/share/${IDS.shareToken}`,
  '/no-such-page',
];

export const LOCALES = ['en', 'fr', 'uk'] as const;

/** English uses no prefix (localePrefix 'as-needed'). */
export function routes(locales: readonly string[] = LOCALES): string[] {
  const out: string[] = [];
  for (const locale of locales) {
    for (const r of localized) {
      out.push(locale === 'en' ? r : `/${locale}${r === '/' ? '' : r}`);
    }
  }
  return [...out, ...plain];
}
