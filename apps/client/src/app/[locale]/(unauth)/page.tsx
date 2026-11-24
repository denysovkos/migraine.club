import type { Metadata } from 'next';

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Fraunces } from 'next/font/google';
import Link from 'next/link';
import { StickyCtaBar } from '@/components/StickyCtaBar';

import { buttonVariants } from '@/components/ui/buttonVariants';
import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';
import { getAbsoluteUrl, getPageAlternates } from '@/utils/seo';
import './marketing.css';

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  axes: ['WONK'],
});

type GenerateMetadataProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: GenerateMetadataProps): Promise<Metadata> {
  const { locale } = await params;

  const t = await getTranslations({
    locale,
    namespace: 'Index',
  });

  const ogImage = getAbsoluteUrl('/og-migraine-club.svg');

  return {
    title: t('meta_title'),
    description: t('meta_description'),
    alternates: getPageAlternates(locale, '/'),
    openGraph: {
      title: t('meta_title'),
      description: t('meta_description'),
      url: getPageAlternates(locale, '/').canonical,
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: t('meta_og_alt'),
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: t('meta_title'),
      description: t('meta_description'),
      images: [ogImage],
    },
  };
}

const IndexPage = async (props: { params: Promise<{ locale: string }> }) => {
  setRequestLocale((await props.params).locale);

  return (
    <>
      <Navbar />
      <HomeContent />
      <Footer />
      <StickyCtaBar />
    </>
  );
};

async function HomeContent() {
  const t = await getTranslations('HomePage');

  const faqItems = [
    { question: 'Will an AI tell me what my triggers are?', answer: 'No. We use conservative correlation analysis with explicit confidence and coverage. If your data says "insufficient," that\'s what you\'ll see. We won\'t manufacture certainty.' },
    { question: 'What if I miss days?', answer: 'Missing days stay missing — they aren\'t counted as headache-free. Coverage % is shown next to every metric so you (and your doctor) know what window the numbers actually describe.' },
    { question: 'Can my doctor see this?', answer: 'Tokenized share links with expiry windows, or a clean PDF you can print. No clinic portal integration required. They just open the link.' },
    { question: 'Is it free?', answer: 'Core tracking is free forever. Validated questionnaires (HIT-6/MIDAS/MSQ-21), weather context, and exports are free. Clinician PDF export and advanced sharing may move to paid later — current users grandfather in.' },
    { question: 'Is this medical advice?', answer: 'No. Migrennity is not a medical device and provides no diagnosis, treatment advice, or predictions. We summarise what you enter against validated definitions. Decisions stay between you and your clinician.' },
  ];

  // One object with @graph rather than a top-level array: equally valid JSON-LD,
  // but consumers that read `data['@context']` directly crash on an array.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        'name': 'Migraine Club',
        'url': getAbsoluteUrl('/'),
        'description': t('schema_org_description'),
      },
      {
        '@type': 'WebSite',
        'name': 'Migraine Club',
        'url': getAbsoluteUrl('/'),
      },
      {
        '@type': 'SoftwareApplication',
        'name': 'Migrennity',
        'applicationCategory': 'HealthApplication',
        'operatingSystem': 'iOS, Android, Web',
        'description': t('schema_app_description'),
        'offers': { '@type': 'Offer', 'price': '0', 'priceCurrency': 'USD' },
      },
      {
        '@type': 'FAQPage',
        'mainEntity': faqItems.map(item => ({
          '@type': 'Question',
          'name': item.question,
          'acceptedAnswer': { '@type': 'Answer', 'text': item.answer },
        })),
      },
    ],
  };

  return (
    <main className={`pb-24 md:pb-0 ${fraunces.variable}`}>

      {/* ── HERO ──────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Soft glow blobs */}
        <div aria-hidden="true" className="pointer-events-none absolute -right-32 -top-40 size-[640px] rounded-full bg-primary/10 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -left-40 top-40 size-[520px] rounded-full bg-violet-500/10 blur-3xl" />

        <div className="relative mx-auto max-w-6xl px-5 pb-12 pt-14 md:grid md:grid-cols-[1.1fr_1fr] md:items-center md:gap-16 md:py-20">
          {/* Copy */}
          <div className="space-y-6">
            <div className="shadow-soft inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Evidence-first · Privacy-first · Made for bad days
            </div>

            <h1 className="font-display text-[44px] font-semibold leading-[1.02] tracking-tight text-foreground sm:text-[52px] md:text-[60px]">
              A migraine diary
              <br />
              you can actually
              {' '}
              <em
                className="not-italic"
                style={{ background: 'linear-gradient(180deg, transparent 60%, hsl(239 84% 67% / 0.18) 60%)' }}
              >
                finish
              </em>
              .
            </h1>

            <p className="max-w-[44ch] text-lg leading-relaxed text-muted-foreground">
              Tap once when an attack starts. Add the rest when you can see again.
              We turn it into a clean summary your neurologist will actually read.
            </p>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/sign-up"
                className={buttonVariants({ size: 'lg' })}
              >
                Start free
                <ArrowRightIcon className="ml-2 size-4" />
              </Link>
              <Link
                href="/install"
                className={buttonVariants({ size: 'lg', variant: 'outline' })}
              >
                See the app
              </Link>
            </div>

            <p className="text-sm text-muted-foreground">
              Twenty seconds today. A different conversation in three months.
            </p>
          </div>

          {/* Phone mockup — Dashboard */}
          <div className="mt-10 flex justify-center md:mt-0 md:justify-end">
            <PhoneMockup>
              <DashboardScreen />
            </PhoneMockup>
          </div>
        </div>

        {/* Trust strip */}
        <div className="relative mx-auto max-w-6xl px-5 pb-12">
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <span className="font-semibold uppercase tracking-wider text-muted-foreground/60">Built on validated measures</span>
            {['HIT-6', 'MIDAS', 'MSQ-21', 'ICHD-3', 'AMF guidance'].map(m => (
              <span key={m} className="font-medium text-foreground/70">{m}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ── PROBLEM ───────────────────────────────────────────── */}
      <section id="why" className="border-t border-border bg-card">
        <div className="mx-auto max-w-5xl px-5 py-20 md:py-28">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-wider text-primary">The honest part</div>
            <h2 className="font-display mt-3 text-3xl font-semibold leading-tight text-foreground md:text-5xl">
              Most migraine apps ask for eight things up front.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
              By the time you've logged trigger checkboxes, intensity sliders, aura, location, and meds,
              you haven't taken your rizatriptan. The app for the moment becomes the obstacle to it.
            </p>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-border bg-muted/50 p-6">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Other diaries</div>
              <ul className="space-y-2.5 text-[15px] text-foreground/80">
                {[
                  'Eight fields before you can log',
                  'Black-box "your trigger is chocolate"',
                  'Charts the doctor never reads',
                  'Data sold to advertisers',
                ].map(t => (
                  <li key={t} className="flex gap-2.5">
                    <span className="text-muted-foreground">—</span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-6">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-primary">Migrennity</div>
              <ul className="space-y-2.5 text-[15px] text-foreground">
                {[
                  'One tap. Pain level + start time. That\'s it.',
                  'Conservative insights with confidence labels',
                  'A doctor-ready summary with ICHD-3 thresholds',
                  'HIPAA-ready infrastructure. We never sell data.',
                ].map(t => (
                  <li key={t} className="flex gap-2.5">
                    <span className="text-primary">✓</span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── PRODUCT TOUR ──────────────────────────────────────── */}
      <section id="product" className="border-t border-border bg-background">
        <div className="mx-auto max-w-6xl space-y-24 px-5 py-20 md:space-y-32 md:py-28">

          {/* Block 1: Diary */}
          <div className="grid items-center gap-12 md:grid-cols-2 md:gap-20">
            <div className="order-2 space-y-5 md:order-1">
              <div className="text-xs font-semibold uppercase tracking-wider text-primary">Daily diary</div>
              <h3 className="font-display text-3xl font-semibold leading-tight md:text-4xl">
                Headache-free days are data too.
              </h3>
              <p className="text-[17px] leading-relaxed text-muted-foreground">
                A blank day in most apps means "didn't bother." In ours, you mark it explicitly.
                That's how outcome metrics like Monthly Migraine Days actually become trustworthy.
              </p>
              <ul className="space-y-3 text-[15px]">
                <DiaryTypeRow color="good" label="Headache-free" desc="explicit, not assumed" />
                <DiaryTypeRow color="warn" label="Headache" desc="mild discomfort separated from migraine" />
                <DiaryTypeRow color="bad" label="Migraine" desc="with symptoms, triggers, response" />
                <DiaryTypeRow color="missing" label="Missing" desc="stays missing. Never invented." />
              </ul>
            </div>
            <div className="order-1 flex justify-center md:order-2">
              <PhoneMockup>
                <DiaryScreen />
              </PhoneMockup>
            </div>
          </div>

          {/* Block 2: Attacks */}
          <div className="grid items-center gap-12 md:grid-cols-2 md:gap-20">
            <div className="flex justify-center">
              <PhoneMockup>
                <AttacksScreen />
              </PhoneMockup>
            </div>
            <div className="space-y-5">
              <div className="text-xs font-semibold uppercase tracking-wider text-primary">Attack log</div>
              <h3 className="font-display text-3xl font-semibold leading-tight md:text-4xl">
                Tap once. Add the rest when you can see again.
              </h3>
              <p className="text-[17px] leading-relaxed text-muted-foreground">
                The first tap captures pain level and start time. The follow-ups —
                symptoms, triggers, what you took, how it helped — wait until you have the energy.
                Most apps treat that as missing data. We treat it as a real life with a real attack.
              </p>
              <div className="flex flex-wrap gap-2">
                {['Pain 1–4 scale', 'Symptom presets', 'Acute med + response', 'Voice notes', 'Weather context'].map(t => (
                  <span key={t} className="inline-flex items-center rounded-full bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground/80">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Block 3: Outcomes */}
          <div className="grid items-center gap-12 md:grid-cols-2 md:gap-20">
            <div className="order-2 space-y-5 md:order-1">
              <div className="text-xs font-semibold uppercase tracking-wider text-primary">Outcomes</div>
              <h3 className="font-display text-3xl font-semibold leading-tight md:text-4xl">
                A summary your neurologist will actually read.
              </h3>
              <p className="text-[17px] leading-relaxed text-muted-foreground">
                Monthly Migraine Days. Monthly Headache Days. Acute Medication Days.
                The metrics from the AMF guidance, with the coverage % shown so confidence is honest.
                Plus HIT-6, MIDAS, and MSQ-21 with full history.
              </p>
              <div className="grid max-w-sm grid-cols-3 gap-3">
                {[
                  { label: 'MMD', value: '0–2', sub: 'last 30d', subColor: '' },
                  { label: 'HIT-6', value: '52', sub: 'moderate', subColor: 'text-amber-700' },
                  { label: 'Acute', value: '3', sub: 'days/mo', subColor: '' },
                ].map(m => (
                  <div key={m.label} className="shadow-soft rounded-xl border border-border bg-card p-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{m.label}</div>
                    <div className="mt-1 text-2xl font-bold tabular-nums text-foreground">{m.value}</div>
                    <div className={`text-[10px] ${m.subColor || 'text-muted-foreground'}`}>{m.sub}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="order-1 flex justify-center md:order-2">
              <PhoneMockup>
                <OutcomesScreen />
              </PhoneMockup>
            </div>
          </div>
        </div>
      </section>

      {/* ── HONEST INSIGHTS ───────────────────────────────────── */}
      <section id="science" className="border-t border-border bg-card">
        <div className="mx-auto max-w-5xl px-5 py-20 md:py-28">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-wider text-primary">Honest insights</div>
            <h2 className="font-display mt-3 text-3xl font-semibold leading-tight text-foreground md:text-5xl">
              Four labels. No black box.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
              Every factor we track gets one of four answers. We don't manufacture a verdict
              when the data isn't there yet — and we tell you so.
            </p>
          </div>

          <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <InsightLabel
              color="bg-red-50 border-red-100"
              labelClass="text-red-700"
              label="Trigger"
              desc="Reliably appears before your attacks. We show coverage and confidence next to every label."
            />
            <InsightLabel
              color="bg-green-50 border-green-100"
              labelClass="text-green-700"
              label="Protector"
              desc="Linked to fewer or shorter attacks. Useful for what to keep doing on purpose."
            />
            <InsightLabel
              color="bg-slate-100 border-slate-200"
              labelClass="text-slate-600"
              label="No association"
              desc="We checked. There's enough data. It isn't doing anything. Stop blaming chocolate."
            />
            <InsightLabel
              color="bg-amber-50 border-amber-100"
              labelClass="text-amber-700"
              label="Insufficient data"
              desc="The honest one. We don't know yet. Ten more days will tell us — or won't."
            />
          </div>

          <div className="mt-12 rounded-2xl border border-border bg-background p-6 md:p-8">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Worked example · last 90 days</div>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <WorkedExample
                icon={<span className="text-xs font-bold text-red-700">↑</span>}
                iconBg="bg-red-100"
                factor="Sleep &lt; 6h"
                result="Trigger · 84% confidence · 21/24 days"
              />
              <WorkedExample
                icon={<span className="text-xs font-bold text-slate-500">·</span>}
                iconBg="bg-slate-200"
                factor="Chocolate"
                result="No association · 72 days observed"
              />
              <WorkedExample
                icon={<span className="text-xs font-bold text-amber-700">?</span>}
                iconBg="bg-amber-100"
                factor="Caffeine timing"
                result="Insufficient data · 11 days needed"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── BUILT FOR BAD DAYS ────────────────────────────────── */}
      <section className="border-t border-border bg-background">
        <div className="mx-auto max-w-5xl px-5 py-20 md:py-28">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary">Built for bad days</div>
          <h2 className="font-display mt-3 max-w-2xl text-3xl font-semibold leading-tight text-foreground md:text-5xl">
            Designed for the moment, not the spreadsheet.
          </h2>

          <div className="mt-12 grid gap-4 md:grid-cols-3">
            <BadDayCard
              quote={`"It's 2 a.m. and the room is moving."`}
              text="Dim mode pulls everything down to a sleeping-room palette in one tap. Big buttons. Less white. No notification sounds."
            />
            <BadDayCard
              quote={`"I don't remember when it started."`}
              text="Backdate freely. The diary lets you revise yesterday and the day before. Outcome metrics recompute automatically; we never silently drop edits."
            />
            <BadDayCard
              quote={`"I just took a triptan. Did I take one yesterday?"`}
              text="Acute-med-day counter is one swipe away — with the WHO/AMF medication-overuse threshold quietly visible so you see the line before you cross it."
            />
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ──────────────────────────────────────── */}
      <section className="bg-slate-900 text-slate-100">
        <div className="mx-auto max-w-5xl px-5 py-20 md:grid md:grid-cols-2 md:gap-16 md:py-28">
          <figure>
            <p className="font-display text-2xl leading-snug text-white md:text-3xl">
              <span className="font-display mr-1 align-top text-5xl leading-none text-primary">"</span>
              I cried in a Target parking lot the first time I exported a doctor summary.
              Eighteen years of "I think it's worse, maybe?" and finally I had numbers.
              We changed my preventive at the next appointment.
            </p>
            <figcaption className="mt-6 flex items-center gap-3 text-sm">
              <div className="flex size-10 items-center justify-center rounded-full bg-primary/30 font-semibold text-white">M</div>
              <div>
                <div className="font-semibold text-white">Maya, 34</div>
                <div className="text-slate-400">Chronic migraine since age 16</div>
              </div>
            </figcaption>
          </figure>

          <figure className="mt-12 md:mt-0">
            <p className="font-display text-2xl leading-snug text-white md:text-3xl">
              <span className="font-display mr-1 align-top text-5xl leading-none text-primary">"</span>
              The MIDAS and HIT-6 progression and the medication-day count
              save me real clinic time. I get a complete picture in 90 seconds
              instead of asking the same questions three different ways.
            </p>
            <figcaption className="mt-6 flex items-center gap-3 text-sm">
              <div className="flex size-10 items-center justify-center rounded-full bg-violet-500/30 font-semibold text-white">P</div>
              <div>
                <div className="font-semibold text-white">Dr. R. Patel</div>
                <div className="text-slate-400">Headache specialist · UCLH</div>
              </div>
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ── PRIVACY ───────────────────────────────────────────── */}
      <section id="privacy" className="border-t border-border bg-card">
        <div className="mx-auto max-w-5xl px-5 py-20 md:grid md:grid-cols-[1.1fr_1fr] md:items-start md:gap-16 md:py-28">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-primary">Privacy</div>
            <h2 className="font-display mt-3 text-3xl font-semibold leading-tight text-foreground md:text-5xl">
              Health data isn't data we get to play with.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
              We charge for the product, not for you. No advertising. No "anonymised data partner" programme.
              Your symptom log is not part of a research dataset unless you opt in, project by project.
            </p>
          </div>
          <ul className="mt-10 space-y-4 text-[15px] md:mt-0">
            {[
              {
                n: '1',
                title: 'HIPAA-ready infrastructure',
                text: 'Neon database with BAA enabled. Clerk for authentication (SOC 2 Type II).',
              },
              {
                n: '2',
                title: 'No analytics on symptoms or attacks',
                text: 'Product telemetry never sees your health entries. Verified in our open privacy doc.',
              },
              {
                n: '3',
                title: 'One-click export and one-click delete',
                text: 'Take all your data. Take none of it. Up to you. We don\'t make either path harder.',
              },
            ].map(item => (
              <li key={item.n} className="flex gap-3">
                <span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  {item.n}
                </span>
                <div>
                  <div className="font-semibold text-foreground">{item.title}</div>
                  <div className="mt-0.5 text-muted-foreground">{item.text}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────── */}
      <section id="faq" className="border-t border-border bg-background">
        <div className="mx-auto max-w-3xl px-5 py-20 md:py-28">
          <h2 className="font-display text-3xl font-semibold text-foreground md:text-5xl">
            Questions you'd actually ask.
          </h2>

          <div className="mt-10 divide-y divide-border border-y border-border">
            {faqItems.map(item => (
              <details key={item.question} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between text-[17px] font-semibold text-foreground">
                  {item.question}
                  <ChevronDownIcon className="size-5 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
                  {item.answer}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ─────────────────────────────────────────── */}
      <section id="start" className="border-t border-border bg-gradient-to-b from-primary/5 to-background">
        <div className="mx-auto max-w-3xl px-5 py-24 text-center md:py-32">
          <h2 className="font-display text-4xl font-semibold leading-[1.05] text-foreground md:text-6xl">
            Twenty seconds today.
            <br />
            <span
              style={{ background: 'linear-gradient(180deg, transparent 65%, hsl(239 84% 67% / 0.18) 65%)' }}
            >
              A different conversation
            </span>
            {' '}
            in three months.
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
            Free forever for tracking. PWA — install on iOS, Android, or desktop. Works offline.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link href="/sign-up" className={buttonVariants({ size: 'lg' })}>
              Start free
              <ArrowRightIcon className="ml-2 size-4" />
            </Link>
            <Link href="/install" className={buttonVariants({ size: 'lg', variant: 'outline' })}>
              Install the PWA
            </Link>
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            No credit card. No medical advice. We never sell health data.
          </p>
        </div>
      </section>

      { }
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </main>
  );
}

/* ── Phone shell ────────────────────────────────────────────── */
function PhoneMockup({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative shrink-0"
      style={{
        width: 280,
        aspectRatio: '9/19.5',
        borderRadius: 44,
        background: '#0f172a',
        padding: 10,
        boxShadow: '0 30px 60px -15px rgba(15,23,42,.25), 0 12px 24px -8px rgba(15,23,42,.12)',
      }}
    >
      {/* Dynamic island */}
      <div
        aria-hidden="true"
        className="absolute left-1/2 z-10 -translate-x-1/2"
        style={{ top: 14, width: 90, height: 26, borderRadius: 999, background: '#000' }}
      />
      {/* Screen */}
      <div
        className="relative size-full overflow-hidden bg-background"
        style={{ borderRadius: 36 }}
      >
        {/* Status bar */}
        <div
          className="flex items-end justify-between px-6 text-[14px] font-semibold text-foreground"
          style={{ height: 44, paddingBottom: 8 }}
        >
          <span>9:41</span>
          <span className="text-xs">●●●</span>
        </div>
        {/* Content */}
        <div className="px-4 pb-4" style={{ height: 'calc(100% - 44px)', overflowY: 'hidden' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/* ── Dashboard screen ───────────────────────────────────────── */
function DashboardScreen() {
  return (
    <div className="space-y-3 text-foreground">
      <div className="flex items-center gap-1.5 pb-1 pt-0.5">
        <span className="text-[11px] font-semibold">Migraine Club</span>
      </div>
      <div className="text-[22px] font-bold leading-tight">Dashboard</div>
      <div className="text-[12px] text-muted-foreground">Welcome back, Maya</div>

      {/* Today card */}
      <div className="shadow-soft rounded-2xl border border-border bg-card p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[13px] font-semibold">How's today going?</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">Fri, May 8</div>
            <div className="mt-1 text-[11px] font-medium text-green-700">Headache-free for 3 days</div>
          </div>
          <span className="inline-flex items-center gap-1 rounded-md bg-green-100 px-2 py-1 text-[11px] font-medium text-green-700">
            ✓ No pain
          </span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-muted p-1 text-[11px] font-medium">
          <button className="shadow-xs rounded-md bg-card py-1.5 text-foreground">No pain</button>
          <button className="rounded-md py-1.5 text-muted-foreground">Headache</button>
          <button className="rounded-md py-1.5 text-muted-foreground">Migraine</button>
        </div>
      </div>

      {/* For today */}
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">For today</div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-2.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-violet-100">
            <span className="text-[10px]">⚡</span>
          </div>
          <span className="text-[12px] font-medium">Start attack</span>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-2.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-green-100">
            <span className="text-[10px]">💊</span>
          </div>
          <span className="text-[12px] font-medium">Take medication</span>
        </div>
      </div>

      {/* Preventives */}
      <div className="rounded-xl border border-border bg-card p-2.5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[12px] font-semibold">Preventives due</div>
            <div className="text-[10px] text-muted-foreground">One tap to keep track</div>
          </div>
          <span className="text-[10px] font-semibold text-primary">Manage</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {['IBUPROFEN', 'SINTROM'].map(med => (
            <div key={med} className="flex items-center justify-between rounded-lg bg-muted/50 p-2">
              <div>
                <div className="text-[10px] font-semibold leading-tight">{med}</div>
                <div className="text-[9px] text-muted-foreground">Daily</div>
              </div>
              <span className="rounded border border-border bg-card px-1.5 py-1 text-[9px] font-semibold">Log</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Diary screen ───────────────────────────────────────────── */
function DiaryScreen() {
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  // 5 rows × 7 = 35 cells; May 2026 starts Thu (offset 3)
  const cells = [
    // eslint-disable-next-line e18e/prefer-array-fill -- need string type, not unknown
    ...Array.from({ length: 3 }, () => 'pad'),
    'free',
    'miss',
    'free',
    'free',
    'free',
    'free',
    'free',
    'miss',
    'miss',
    'miss',
    'miss',
    'miss',
    'miss',
    'miss',
    'miss',
    'miss',
    'miss',
    'miss',
    'miss',
    'miss',
    'mig',
    'miss',
    'miss',
    'miss',
    'miss',
    'miss',
    'miss',
    'miss',
    'miss',
    'miss',
  ];

  const cellClass: Record<string, string> = {
    free: 'bg-green-100 text-green-700',
    mig: 'bg-red-100 text-red-700',
    head: 'bg-amber-100 text-amber-700',
    miss: 'border border-border text-muted-foreground/50 bg-card',
    pad: 'bg-transparent',
  };

  return (
    <div className="text-foreground">
      <div className="pb-2 pt-0.5 text-[20px] font-bold leading-tight">Diary</div>
      <div className="mb-2 text-[10px] text-muted-foreground">Daily check-in. Explicit headache-free days.</div>

      <div className="rounded-xl border border-border bg-card p-2.5">
        <div className="flex items-center justify-between text-[11px] font-semibold">
          <button className="flex size-6 items-center justify-center rounded-md border border-border text-muted-foreground">‹</button>
          <div className="text-center">
            <div className="text-[12px]">May 2026</div>
            <div className="text-[9px] font-normal text-muted-foreground">Recorded 6/31</div>
          </div>
          <button className="flex size-6 items-center justify-center rounded-md border border-border text-muted-foreground">›</button>
        </div>
        <div className="mt-2 grid grid-cols-7 gap-0.5 text-center text-[8px] font-medium text-muted-foreground">
          {days.map((d, i) => <span key={i}>{d}</span>)}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((t, i) => (
            <div
              key={i}
              className={`flex aspect-square items-center justify-center rounded-[3px] text-[7px] font-medium ${cellClass[t] ?? ''}`}
            >
              {t !== 'pad' ? i - 2 : ''}
            </div>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1 text-[8px]">
          {[['bg-red-100 border-red-300', 'Migraine'], ['bg-amber-100 border-amber-300', 'Headache'], ['bg-green-100 border-green-300', 'Free']].map(([cls, label]) => (
            <div key={label} className="flex items-center gap-1">
              <span className={`size-2 rounded border ${cls}`} />
              <span className="text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-2 rounded-xl border border-border bg-card p-2.5">
        <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-700">Streak</div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="text-[24px] font-bold tabular-nums text-foreground">3</span>
          <span className="text-[11px] text-muted-foreground">headache-free days</span>
        </div>
        <div className="mt-2 flex gap-1">
          {[true, true, true, false, false].map((filled, i) => (
            <span key={i} className={`h-1.5 flex-1 rounded-full ${filled ? 'bg-green-200' : 'bg-muted'}`} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Attacks screen ─────────────────────────────────────────── */
function AttacksScreen() {
  const rows = [
    { date: 'Mar 5', ago: '2 mo ago', type: 'Headache', pain: '3 Moderate', painClass: 'bg-amber-100 text-amber-700', duration: '1h 33m', triggers: 'No triggers' },
    { date: 'Jan 25', ago: '3 mo ago', type: 'Migraine', pain: '3 Moderate', painClass: 'bg-amber-100 text-amber-700', duration: '65h 2m', triggers: 'No triggers' },
    { date: 'Jan 5', ago: '4 mo ago', type: 'Migraine', pain: '4 Severe', painClass: 'bg-red-100 text-red-700', duration: '112h 5m', triggers: 'Stress, Weather', highlight: true },
    { date: 'Dec 26', ago: '4 mo ago', type: 'Migraine', pain: '3 Moderate', painClass: 'bg-amber-100 text-amber-700', duration: '50h 12m', triggers: 'No triggers' },
  ];

  return (
    <div className="text-foreground">
      <div className="flex items-center justify-between pb-2 pt-0.5">
        <div>
          <div className="text-[20px] font-bold leading-tight">Attacks</div>
          <div className="text-[10px] text-muted-foreground">Everything you've recorded</div>
        </div>
        <button className="rounded-lg bg-primary px-2.5 py-1.5 text-[10px] font-semibold text-white">Log attack</button>
      </div>

      <div className="divide-y divide-border rounded-xl border border-border bg-card">
        {rows.map((row, i) => (
          <div key={i} className={`flex items-center gap-2 p-2.5 ${row.highlight ? 'bg-muted/30' : ''}`}>
            <div className="w-9 shrink-0">
              <div className="text-[11px] font-semibold leading-tight">{row.date}</div>
              <div className="text-[9px] text-muted-foreground">{row.ago}</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1">
                <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-foreground/80">{row.type}</span>
                <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-medium ${row.painClass}`}>{row.pain}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1 text-[9px] text-muted-foreground">
                <span>
                  {row.duration}
                  {' '}
                  ·
                </span>
                {row.triggers !== 'No triggers'
                  ? row.triggers.split(', ').map(t => (
                      <span key={t} className="rounded bg-red-50 px-1 text-red-700">{t}</span>
                    ))
                  : <span>{row.triggers}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Outcomes screen ────────────────────────────────────────── */
function OutcomesScreen() {
  return (
    <div className="text-foreground">
      <div className="pb-2 pt-0.5 text-[20px] font-bold leading-tight">Outcomes</div>
      <div className="mb-2 text-[10px] text-muted-foreground">Doctor-ready summary metrics</div>

      <div className="mb-2 flex gap-1">
        <button className="rounded-lg bg-primary px-2 py-1 text-[9px] font-semibold text-white">Current</button>
        <button className="rounded-lg border border-border bg-card px-2 py-1 text-[9px] font-medium text-muted-foreground">60d</button>
        <button className="rounded-lg border border-border bg-card px-2 py-1 text-[9px] font-medium text-muted-foreground">90d</button>
      </div>

      {/* Heatmap */}
      <div className="rounded-xl border border-border bg-card p-2.5">
        <div className="mb-1.5 flex items-center justify-between">
          <div className="text-[10px] font-semibold">12-week trend</div>
          <div className="text-[9px] text-muted-foreground">MMD</div>
        </div>
        <div className="grid grid-flow-col grid-rows-7 gap-0.5">
          {Array.from({ length: 84 }).map((_, i) => {
            const col = Math.floor(i / 7);
            const lean = Math.max(0, 4 - Math.floor(col / 2.5));
            const seed = (i * 7 + 13) % 100;
            const v = seed > 92 ? Math.min(4, lean) : seed > 78 ? Math.min(3, lean) : seed > 60 ? Math.min(2, lean) : seed > 40 ? Math.min(1, lean) : 0;
            const colors = ['bg-slate-100', 'bg-amber-200', 'bg-amber-400', 'bg-red-400', 'bg-red-600'];
            return <span key={i} className={`size-2.5 rounded-sm ${colors[v]}`} />;
          })}
        </div>
      </div>

      {/* Score cards */}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-border bg-card p-2.5">
          <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">HIT-6</div>
          <div className="mt-0.5 flex items-baseline gap-1">
            <span className="text-[20px] font-bold tabular-nums">52</span>
            <span className="text-[9px] font-medium text-amber-700">moderate</span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
            <span className="block h-full w-[55%] rounded-full bg-amber-500" />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-2.5">
          <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">MIDAS</div>
          <div className="mt-0.5 flex items-baseline gap-1">
            <span className="text-[20px] font-bold tabular-nums">11</span>
            <span className="text-[9px] font-medium text-muted-foreground">grade II</span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
            <span className="block h-full w-2/5 rounded-full bg-cyan-500" />
          </div>
        </div>
      </div>

      <button className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg bg-foreground py-2 text-[10px] font-semibold text-background">
        ↓ Export for doctor
      </button>
    </div>
  );
}

/* ── Small helper components ────────────────────────────────── */
function DiaryTypeRow({ color, label, desc }: { color: 'good' | 'warn' | 'bad' | 'missing'; label: string; desc: string }) {
  const iconMap = {
    good: <span className="text-[10px] text-green-700">✓</span>,
    warn: <span className="text-[11px] font-bold text-amber-700">!</span>,
    bad: <span className="inline-block size-2 rounded-full bg-red-600" />,
    missing: null,
  };
  const bgMap = {
    good: 'bg-green-100',
    warn: 'bg-amber-100',
    bad: 'bg-red-100',
    missing: 'border border-border bg-card',
  };
  return (
    <li className="flex items-start gap-3 text-[15px]">
      <span className={`mt-1 inline-flex size-5 shrink-0 items-center justify-center rounded ${bgMap[color]}`}>
        {iconMap[color]}
      </span>
      <span>
        <span className="font-semibold text-foreground">{label}</span>
        <span className="text-muted-foreground">
          {' '}
          ·
          {desc}
        </span>
      </span>
    </li>
  );
}

function InsightLabel({ color, labelClass, label, desc }: { color: string; labelClass: string; label: string; desc: string }) {
  return (
    <div className={`rounded-2xl border p-5 ${color}`}>
      <div className={`text-xs font-semibold uppercase tracking-wider ${labelClass}`}>{label}</div>
      <p className="mt-2 text-sm leading-relaxed text-foreground/80">{desc}</p>
    </div>
  );
}

function WorkedExample({ icon, iconBg, factor, result }: { icon: React.ReactNode; iconBg: string; factor: string; result: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className={`mt-1 inline-flex size-6 shrink-0 items-center justify-center rounded ${iconBg}`}>
        {icon}
      </span>
      <div>
        <div className="font-semibold text-foreground" dangerouslySetInnerHTML={{ __html: factor }} />
        <div className="mt-0.5 text-sm text-muted-foreground">{result}</div>
      </div>
    </div>
  );
}

function BadDayCard({ quote, text }: { quote: string; text: string }) {
  return (
    <div className="shadow-soft rounded-2xl border border-border bg-card p-6">
      <p className="font-display text-2xl leading-tight text-foreground">{quote}</p>
      <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}

/* ── Inline SVG icons ───────────────────────────────────────── */
function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export default IndexPage;
