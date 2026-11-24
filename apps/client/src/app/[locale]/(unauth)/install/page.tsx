import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Fraunces } from 'next/font/google';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/buttonVariants';

import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';
import { getAbsoluteUrl, getPageAlternates } from '@/utils/seo';
import '../marketing.css';

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  axes: ['WONK'],
});

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({
    locale: (await props.params).locale,
    namespace: 'InstallPage',
  });

  const ogImage = getAbsoluteUrl('/og-migraine-club.svg');

  return {
    title: t('meta_title'),
    description: t('meta_description'),
    alternates: getPageAlternates((await props.params).locale, '/install'),
    openGraph: {
      title: t('meta_title'),
      description: t('meta_description'),
      url: getPageAlternates((await props.params).locale, '/install').canonical,
      images: [{ url: ogImage, width: 1200, height: 630, alt: t('meta_og_alt') }],
    },
    twitter: {
      card: 'summary_large_image',
      title: t('meta_title'),
      description: t('meta_description'),
      images: [ogImage],
    },
  };
}

const InstallPage = async (props: { params: Promise<{ locale: string }> }) => {
  setRequestLocale((await props.params).locale);
  return (
    <>
      <Navbar />
      <InstallContent />
      <Footer />
    </>
  );
};

/* ── Inline SVG icons for clarity (no extra deps) ─────────────── */

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.7 9.05 7.42c1.39.07 2.35.74 3.17.8 1.2-.24 2.35-.93 3.64-.84 1.56.12 2.73.72 3.5 1.92-3.21 1.87-2.46 6.07.73 7.25-.53 1.36-1.24 2.7-3.04 3.73ZM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25Z" />
    </svg>
  );
}

function AndroidIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.523 15.341A6.506 6.506 0 0 0 18.5 12a6.506 6.506 0 0 0-.977-3.341L19.5 6.682 18.086 5.27l-1.976 1.977A6.463 6.463 0 0 0 12 5.5c-1.327 0-2.56.4-3.586 1.073L6.438 4.596 5.023 6.01l1.977 1.978A6.506 6.506 0 0 0 5.5 12a6.506 6.506 0 0 0 1.5 4.159V18.5h10v-2.341l.523-.818ZM9 14a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm6 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
    </svg>
  );
}

function MonitorIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

/* iOS share icon (box + up arrow — the actual Safari share icon shape) */
function ShareIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

function MenuDotsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  );
}

function AddressBarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M12 10v4M10 12h4" />
    </svg>
  );
}

/* ── Step card component ───────────────────────────────────────── */
function Step({ number, icon, title, desc, highlight }: {
  number: number;
  icon: React.ReactNode;
  title: string;
  desc?: string;
  highlight?: string;
}) {
  return (
    <div className="flex items-start gap-5">
      {/* Number */}
      <div className="font-display flex size-12 shrink-0 items-center justify-center rounded-2xl border-2 border-primary/20 bg-primary/5 text-xl font-semibold text-primary">
        {number}
      </div>

      <div className="flex-1 pt-1.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
            {icon}
          </div>
          <span className="text-[17px] font-semibold text-foreground">{title}</span>
        </div>
        {desc && (
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{desc}</p>
        )}
        {highlight && (
          <div className="mt-2 inline-flex items-center rounded-lg border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
            {highlight}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Platform section ─────────────────────────────────────────── */
function PlatformSection({ icon, platform, browser, color, steps }: {
  icon: React.ReactNode;
  platform: string;
  browser: string;
  color: string;
  steps: React.ReactNode[];
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      {/* Platform header */}
      <div className={`flex items-center gap-3 border-b border-border px-6 py-4 ${color}`}>
        <div className="flex size-10 items-center justify-center rounded-xl bg-white/80 shadow-sm">
          {icon}
        </div>
        <div>
          <div className="text-lg font-semibold text-foreground">{platform}</div>
          <div className="text-xs text-muted-foreground">{browser}</div>
        </div>
      </div>

      {/* Steps */}
      <div className="divide-y divide-border/60 px-6">
        {steps.map((step, i) => (
          <div key={i} className="py-5">
            {step}
          </div>
        ))}
      </div>
    </div>
  );
}

async function InstallContent() {
  const t = await getTranslations('InstallPage');

  return (
    <main className={`pb-24 md:pb-0 ${fraunces.variable}`}>

      {/* ── HERO ──────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div aria-hidden="true" className="pointer-events-none absolute -right-32 -top-40 size-[480px] rounded-full bg-primary/10 blur-3xl" />

        <div className="relative mx-auto max-w-3xl px-5 pb-12 pt-14 text-center md:pb-16 md:pt-20">
          <div className="shadow-soft inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            No app store · Works offline · Free
          </div>

          <h1 className="font-display mt-5 text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground sm:text-[50px]">
            {t('hero_title')}
          </h1>

          <p className="mx-auto mt-4 max-w-[44ch] text-lg leading-relaxed text-muted-foreground">
            {t('hero_subtitle')}
          </p>

          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/sign-up" className={buttonVariants({ size: 'lg' })}>
              {t('hero_cta')}
            </Link>
            <a href="#install-steps" className={buttonVariants({ size: 'lg', variant: 'outline' })}>
              See steps ↓
            </a>
          </div>

          {/* "What is a PWA?" mini-explainer */}
          <div className="shadow-soft mx-auto mt-10 max-w-md rounded-2xl border border-border bg-card p-5 text-left">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
              What is a PWA?
            </div>
            <div className="space-y-2">
              {[
                { icon: '📱', text: 'Looks and feels like a native app on your home screen' },
                { icon: '📶', text: 'Works offline — no connection needed to log an attack' },
                { icon: '🔒', text: 'No app store account required — just open in your browser' },
                { icon: '⚡', text: 'Instant updates — no manual downloads ever' },
              ].map(item => (
                <div key={item.text} className="flex items-start gap-3">
                  <span className="text-base leading-snug">{item.icon}</span>
                  <span className="text-sm leading-snug text-muted-foreground">{item.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── INSTALL STEPS ─────────────────────────────────────── */}
      <section id="install-steps" className="border-t border-border bg-background">
        <div className="mx-auto max-w-3xl px-5 py-16 md:py-24">
          <h2 className="font-display text-3xl font-semibold text-foreground md:text-4xl">
            Pick your device
          </h2>
          <p className="mt-2 text-muted-foreground">
            Three steps. Under a minute. Works on any device.
          </p>

          <div className="mt-10 space-y-6">

            {/* iPhone */}
            <PlatformSection
              icon={<AppleIcon className="size-6 text-slate-700" />}
              platform={t('ios_title')}
              browser={t('ios_subtitle')}
              color="bg-slate-50"
              steps={[
                <Step
                  key="ios-1"
                  number={1}
                  icon={(
                    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="8" cy="8" r="6" />
                      <path d="M8 5v3l2 1.5" />
                    </svg>
                  )}
                  title={t('ios_step1')}
                  desc="Safari is the browser that looks like a compass. It's already on your iPhone."
                />,
                <Step
                  key="ios-2"
                  number={2}
                  icon={<ShareIcon className="size-3.5" />}
                  title={t('ios_step2')}
                  highlight="Look for the Share icon — a box with an arrow pointing up ↑"
                />,
                <Step
                  key="ios-3"
                  number={3}
                  icon={<svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="3 8 6.5 11.5 13 4.5" /></svg>}
                  title={t('ios_step3')}
                  desc="The app icon will appear on your home screen, just like any other app."
                />,
              ]}
            />

            {/* Android */}
            <PlatformSection
              icon={<AndroidIcon className="size-6 text-emerald-700" />}
              platform={t('android_title')}
              browser={t('android_subtitle')}
              color="bg-emerald-50"
              steps={[
                <Step
                  key="android-1"
                  number={1}
                  icon={(
                    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="8" cy="8" r="6" />
                      <path d="M8 5v3l2 1.5" />
                    </svg>
                  )}
                  title={t('android_step1')}
                  desc="Chrome is the app with the colourful circle icon. If you don't have it, download it first."
                />,
                <Step
                  key="android-2"
                  number={2}
                  icon={<MenuDotsIcon className="size-3.5" />}
                  title={t('android_step2')}
                  highlight='Tap ⋮ (three dots, top-right) → "Install app" or "Add to Home screen"'
                />,
                <Step
                  key="android-3"
                  number={3}
                  icon={<svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="3 8 6.5 11.5 13 4.5" /></svg>}
                  title={t('android_step3')}
                />,
              ]}
            />

            {/* Desktop */}
            <PlatformSection
              icon={<MonitorIcon className="size-6 text-primary" />}
              platform={t('desktop_title')}
              browser={t('desktop_subtitle')}
              color="bg-primary/5"
              steps={[
                <Step
                  key="desktop-1"
                  number={1}
                  icon={(
                    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="8" cy="8" r="6" />
                      <path d="M8 5v3l2 1.5" />
                    </svg>
                  )}
                  title={t('desktop_step1')}
                />,
                <Step
                  key="desktop-2"
                  number={2}
                  icon={<AddressBarIcon className="size-3.5" />}
                  title={t('desktop_step2')}
                  highlight="Look for a small download icon (⊕) at the right end of the address bar"
                />,
                <Step
                  key="desktop-3"
                  number={3}
                  icon={<svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="3 8 6.5 11.5 13 4.5" /></svg>}
                  title={t('desktop_step3')}
                />,
              ]}
            />

          </div>
        </div>
      </section>

      {/* ── TROUBLESHOOTING ───────────────────────────────────── */}
      <section className="border-t border-border bg-card">
        <div className="mx-auto max-w-3xl px-5 py-12 md:py-16">
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between text-lg font-semibold text-foreground">
              {t('troubleshooting_title')}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-5 text-muted-foreground transition-transform group-open:rotate-180">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </summary>

            <div className="mt-6 space-y-4">
              {[
                {
                  q: 'No install button?',
                  a: 'Make sure you\'re on HTTPS (the URL starts with https://) and not in a private / incognito window. Private windows block PWA install.',
                },
                {
                  q: 'On iPhone — I don\'t see "Add to Home Screen"',
                  a: 'You must use Safari. Chrome and Firefox on iOS cannot install PWAs due to Apple restrictions. Open the site in Safari, then tap the Share icon.',
                },
                {
                  q: 'The app doesn\'t work offline',
                  a: 'Open the app once while on Wi-Fi and navigate through a couple of screens. This caches the data locally. After that, offline mode activates automatically.',
                },
                {
                  q: t('troubleshooting_item2'),
                  a: 'Go to your browser settings → Notifications → find migraine.club → Allow.',
                },
              ].map(item => (
                <div key={item.q} className="rounded-xl border border-border bg-background px-5 py-4">
                  <div className="text-sm font-semibold text-foreground">{item.q}</div>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{item.a}</p>
                </div>
              ))}
            </div>
          </details>
        </div>
      </section>

      {/* ── FINAL CTA ─────────────────────────────────────────── */}
      <section className="border-t border-border bg-gradient-to-b from-primary/5 to-background">
        <div className="mx-auto max-w-3xl px-5 py-20 text-center md:py-28">
          <h2 className="font-display text-3xl font-semibold text-foreground md:text-5xl">
            Installed. Now start tracking.
          </h2>
          <p className="mx-auto mt-4 max-w-[40ch] text-lg text-muted-foreground">
            Your first entry takes 20 seconds. Your first insight arrives in two weeks.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/sign-up" className={buttonVariants({ size: 'lg' })}>
              {t('hero_cta')}
            </Link>
          </div>
          <p className="mt-4 text-sm text-muted-foreground/60">
            Free forever for tracking. No credit card.
          </p>
        </div>
      </section>

    </main>
  );
}

export default InstallPage;
