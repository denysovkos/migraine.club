import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Fraunces } from 'next/font/google';
import Link from 'next/link';
import { StickyCtaBar } from '@/components/StickyCtaBar';

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
    namespace: 'ProductPage',
  });

  const ogImage = getAbsoluteUrl('/og-migraine-club.svg');

  return {
    title: t('meta_title'),
    description: t('meta_description'),
    alternates: getPageAlternates((await props.params).locale, '/product'),
    openGraph: {
      title: t('meta_title'),
      description: t('meta_description'),
      url: getPageAlternates((await props.params).locale, '/product').canonical,
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

const ProductPage = async (props: { params: Promise<{ locale: string }> }) => {
  setRequestLocale((await props.params).locale);
  return (
    <>
      <Navbar />
      <ProductContent />
      <Footer />
      <StickyCtaBar />
    </>
  );
};

async function ProductContent() {
  const t = await getTranslations('ProductPage');

  const faqItems = [
    { question: t('faq_q1_question'), answer: t('faq_q1_answer') },
    { question: t('faq_q2_question'), answer: t('faq_q2_answer') },
    { question: t('faq_q3_question'), answer: t('faq_q3_answer') },
    { question: t('faq_q4_question'), answer: t('faq_q4_answer') },
  ];

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      'name': 'Migrennity',
      'applicationCategory': 'HealthApplication',
      'operatingSystem': 'iOS, Android, Web',
      'description': t('schema_app_description'),
      'offers': { '@type': 'Offer', 'price': '0', 'priceCurrency': 'USD' },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      'mainEntity': faqItems.map(item => ({
        '@type': 'Question',
        'name': item.question,
        'acceptedAnswer': { '@type': 'Answer', 'text': item.answer },
      })),
    },
  ];

  return (
    <main className={`pb-24 md:pb-0 ${fraunces.variable}`}>

      {/* ── HERO ──────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div aria-hidden="true" className="pointer-events-none absolute -right-32 -top-40 size-[540px] rounded-full bg-primary/10 blur-3xl" />

        <div className="relative mx-auto max-w-6xl px-5 pb-12 pt-14 md:grid md:grid-cols-[1.1fr_1fr] md:items-center md:gap-16 md:py-20">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Every feature, explained
            </div>

            <h1 className="font-display text-[40px] font-semibold leading-[1.05] tracking-tight text-foreground sm:text-[52px] md:text-[60px]">
              {t('hero_title')}
            </h1>

            <p className="max-w-[44ch] text-lg leading-relaxed text-muted-foreground">
              {t('hero_subtitle')}
            </p>

            <div className="flex flex-wrap gap-3">
              <Link href="/sign-up" className={buttonVariants({ size: 'lg' })}>
                {t('hero_primary_cta')}
                <ArrowRightIcon className="ml-2 size-4" />
              </Link>
              <Link href="/install" className={buttonVariants({ size: 'lg', variant: 'outline' })}>
                {t('hero_secondary_cta')}
              </Link>
            </div>

            <p className="text-sm text-muted-foreground">{t('hero_note')}</p>
          </div>

          {/* Phone — Dashboard */}
          <div className="mt-10 flex justify-center md:mt-0 md:justify-end">
            <PhoneMockup>
              <DashboardScreen />
            </PhoneMockup>
          </div>
        </div>

        {/* Validated measures strip */}
        <div className="relative mx-auto max-w-6xl px-5 pb-10">
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs">
            <span className="font-semibold uppercase tracking-wider text-muted-foreground/60">
              Built on
            </span>
            {[
              { label: 'HIT-6', href: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3057423/' },
              { label: 'MIDAS', href: 'https://pubmed.ncbi.nlm.nih.gov/11098098/' },
              { label: 'MSQ-21', href: 'https://pubmed.ncbi.nlm.nih.gov/21929662/' },
              { label: 'ICHD-3', href: 'https://ichd-3.org' },
              { label: 'AMF guidance', href: 'https://americanmigrainefoundation.org/resource-library/headache-journals/' },
            ].map(s => (
              <Link
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-foreground/70 hover:text-foreground"
              >
                {s.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── SCIENCE ───────────────────────────────────────────── */}
      <section id="science" className="scroll-mt-20 border-t border-border bg-card">
        <div className="mx-auto max-w-5xl px-5 py-16 md:py-24">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-wider text-primary">
              Evidence base
            </div>
            <h2 className="font-display mt-3 text-3xl font-semibold leading-tight text-foreground md:text-4xl">
              {t('science_title')}
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              {t('science_text')}
            </p>
          </div>

          <div className="mt-8 flex flex-wrap gap-2">
            {[
              { label: t('science_source_1'), href: 'https://americanmigrainefoundation.org/resource-library/headache-journals/' },
              { label: t('science_source_2'), href: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3057423/' },
              { label: t('science_source_3'), href: 'https://pubmed.ncbi.nlm.nih.gov/11098098/' },
              { label: t('science_source_4'), href: 'https://pubmed.ncbi.nlm.nih.gov/21929662/' },
              { label: t('science_source_5'), href: 'https://ichd-3.org/8-headache-attributed-to-a-substance-or-its-withdrawal/8-2-medication-overuse-headache-moh/' },
              { label: t('science_source_6'), href: 'https://ichd-3.org/appendix/a1-migraine/' },
            ].map(s => (
              <Link
                key={s.href}
                href={s.href}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition hover:border-foreground/30 hover:text-foreground"
              >
                {s.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── ATTACK LOGGING ────────────────────────────────────── */}
      <section id="logging" className="scroll-mt-20 border-t border-border bg-background">
        <div className="mx-auto max-w-6xl px-5 py-16 md:py-24">
          <div className="grid items-center gap-12 md:grid-cols-2 md:gap-20">

            <div className="space-y-5">
              <div className="text-xs font-semibold uppercase tracking-wider text-primary">
                Attack logging
              </div>
              <h2 className="font-display text-3xl font-semibold leading-tight text-foreground md:text-4xl">
                {t('logging_title')}
              </h2>
              <p className="text-lg leading-relaxed text-muted-foreground">
                {t('logging_text')}
              </p>

              <div className="grid gap-3">
                {[
                  {
                    n: '1',
                    title: t('logging_demo_step1_title'),
                    items: [t('logging_demo_step1_item1'), t('logging_demo_step1_item2'), t('logging_demo_step1_item3')],
                  },
                  {
                    n: '2',
                    title: t('logging_demo_step2_title'),
                    items: [t('logging_demo_step2_item1'), t('logging_demo_step2_item2'), t('logging_demo_step2_item3')],
                  },
                  {
                    n: '3',
                    title: t('logging_demo_step3_title'),
                    items: [t('logging_demo_step3_item1'), t('logging_demo_step3_item2'), t('logging_demo_step3_item3')],
                  },
                ].map(step => (
                  <div key={step.n} className="flex gap-3 rounded-xl border border-border bg-card p-4">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                      {step.n}
                    </span>
                    <div>
                      <div className="text-sm font-semibold text-foreground">{step.title}</div>
                      <ul className="mt-1.5 space-y-0.5">
                        {step.items.map(item => (
                          <li key={item} className="text-sm text-muted-foreground">{item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-center">
              <PhoneMockup>
                <AttackLogScreen />
              </PhoneMockup>
            </div>
          </div>
        </div>
      </section>

      {/* ── DAILY DIARY ───────────────────────────────────────── */}
      <section id="diary" className="scroll-mt-20 border-t border-border bg-card">
        <div className="mx-auto max-w-6xl px-5 py-16 md:py-24">
          <div className="grid items-center gap-12 md:grid-cols-2 md:gap-20">
            <div className="flex justify-center">
              <PhoneMockup>
                <DiaryScreen />
              </PhoneMockup>
            </div>

            <div className="space-y-5">
              <div className="text-xs font-semibold uppercase tracking-wider text-primary">
                Daily diary
              </div>
              <h2 className="font-display text-3xl font-semibold leading-tight text-foreground md:text-4xl">
                {t('diary_title')}
              </h2>
              <p className="text-lg leading-relaxed text-muted-foreground">
                {t('diary_text')}
              </p>

              <ul className="space-y-3">
                {[
                  { color: 'good' as const, label: 'Headache-free', desc: 'explicit mark, never assumed' },
                  { color: 'warn' as const, label: 'Headache', desc: 'mild discomfort logged separately' },
                  { color: 'bad' as const, label: 'Migraine', desc: 'with symptoms, triggers, response' },
                  { color: 'missing' as const, label: 'Missing', desc: 'stays missing. Never invented.' },
                ].map(row => (
                  <DiaryTypeRow key={row.label} {...row} />
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── TREATMENTS ────────────────────────────────────────── */}
      <section id="treatments" className="scroll-mt-20 border-t border-border bg-background">
        <div className="mx-auto max-w-5xl px-5 py-16 md:py-24">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-wider text-primary">
              Medications
            </div>
            <h2 className="font-display mt-3 text-3xl font-semibold leading-tight text-foreground md:text-4xl">
              {t('treatments_title')}
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              {t('treatments_text')}
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <div className="flex size-10 items-center justify-center rounded-xl bg-red-100">
                <span className="text-lg">⚡</span>
              </div>
              <h3 className="mt-3 text-base font-semibold text-foreground">Acute medications</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Log what you took, when, and how well it worked. Track medication-overuse risk
                with the WHO/AMF threshold quietly visible before you cross it.
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <div className="flex size-10 items-center justify-center rounded-xl bg-violet-100">
                <span className="text-lg">🗓</span>
              </div>
              <h3 className="mt-3 text-base font-semibold text-foreground">Preventive treatments</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Daily adherence logging with one tap. See your streak and coverage so your doctor
                knows how consistently you've been taking them.
              </p>
            </div>
          </div>

          <p className="mt-5 text-sm text-muted-foreground">{t('treatments_note')}</p>
        </div>
      </section>

      {/* ── OUTCOMES ──────────────────────────────────────────── */}
      <section id="outcomes" className="scroll-mt-20 border-t border-border bg-card">
        <div className="mx-auto max-w-6xl px-5 py-16 md:py-24">
          <div className="grid items-center gap-12 md:grid-cols-2 md:gap-20">
            <div className="space-y-5">
              <div className="text-xs font-semibold uppercase tracking-wider text-primary">
                Outcomes
              </div>
              <h2 className="font-display text-3xl font-semibold leading-tight text-foreground md:text-4xl">
                {t('outcomes_title')}
              </h2>
              <p className="text-lg leading-relaxed text-muted-foreground">
                {t('outcomes_text')}
              </p>
              <p className="text-sm text-muted-foreground">
                {t('outcomes_why')}
                {' '}
                <Link
                  href="https://americanmigrainefoundation.org/resource-library/headache-journals/"
                  className="text-primary hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('outcomes_source')}
                </Link>
              </p>

              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'MMD', value: '0–2', sub: 'last 30 days' },
                  { label: 'HIT-6', value: '52', sub: 'moderate impact', subClass: 'text-amber-700' },
                  { label: 'Acute', value: '3', sub: 'days / month' },
                ].map(m => (
                  <div key={m.label} className="rounded-xl border border-border bg-background p-3 shadow-sm">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {m.label}
                    </div>
                    <div className="mt-1 text-xl font-bold tabular-nums text-foreground">{m.value}</div>
                    <div className={`text-[11px] ${m.subClass ?? 'text-muted-foreground'}`}>{m.sub}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-center">
              <PhoneMockup>
                <OutcomesScreen />
              </PhoneMockup>
            </div>
          </div>
        </div>
      </section>

      {/* ── QUESTIONNAIRES ────────────────────────────────────── */}
      <section id="questionnaires" className="scroll-mt-20 border-t border-border bg-background">
        <div className="mx-auto max-w-5xl px-5 py-16 md:py-24">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-wider text-primary">
              Validated questionnaires
            </div>
            <h2 className="font-display mt-3 text-3xl font-semibold leading-tight text-foreground md:text-4xl">
              {t('questionnaires_title')}
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              {t('questionnaires_text')}
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {[
              {
                label: 'HIT-6',
                full: 'Headache Impact Test',
                desc: 'Six questions. Scores 36–78. Tracks impact severity over time.',
                href: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3057423/',
                source: t('questionnaires_source_1'),
              },
              {
                label: 'MIDAS',
                full: 'Migraine Disability Assessment',
                desc: 'Five questions. Measures lost productive days across work and social life.',
                href: 'https://pubmed.ncbi.nlm.nih.gov/11098098/',
                source: t('questionnaires_source_2'),
              },
              {
                label: 'MSQ-21',
                full: 'Migraine-Specific Quality of Life',
                desc: '21 questions across three domains: role function, role prevention, emotional function.',
                href: 'https://pubmed.ncbi.nlm.nih.gov/21929662/',
                source: t('questionnaires_source_3'),
              },
            ].map(q => (
              <div key={q.label} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <div className="text-xs font-bold uppercase tracking-wider text-primary">{q.label}</div>
                <div className="mt-1 text-sm font-semibold text-foreground">{q.full}</div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{q.desc}</p>
                <Link
                  href={q.href}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  {q.source}
                  <ExternalLinkIcon className="size-3" />
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HONEST INSIGHTS ───────────────────────────────────── */}
      <section id="insights" className="scroll-mt-20 border-t border-border bg-card">
        <div className="mx-auto max-w-5xl px-5 py-16 md:py-24">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-wider text-primary">
              Honest insights
            </div>
            <h2 className="font-display mt-3 text-3xl font-semibold leading-tight text-foreground md:text-4xl">
              {t('insights_title')}
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              {t('insights_text')}
            </p>
          </div>

          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <InsightLabel
              cardClass="bg-red-50 border-red-100"
              labelClass="text-red-700"
              label="Trigger"
              desc="Reliably appears before your attacks. Coverage and confidence shown next to every label."
            />
            <InsightLabel
              cardClass="bg-green-50 border-green-100"
              labelClass="text-green-700"
              label="Protector"
              desc="Linked to fewer or shorter attacks. Useful for what to keep doing on purpose."
            />
            <InsightLabel
              cardClass="bg-slate-100 border-slate-200"
              labelClass="text-slate-600"
              label="No association"
              desc="We checked. There's enough data. It isn't doing anything. Stop blaming chocolate."
            />
            <InsightLabel
              cardClass="bg-amber-50 border-amber-100"
              labelClass="text-amber-700"
              label="Insufficient data"
              desc="The honest one. We don't know yet. Ten more days will tell us — or won't."
            />
          </div>

          <div className="mt-8 rounded-2xl border border-border bg-background p-6 md:p-8">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('insights_item5')}
            </div>
            <ul className="mt-4 grid gap-3 sm:grid-cols-3">
              {[
                { icon: '↑', iconBg: 'bg-red-100', iconColor: 'text-red-700', factor: 'Sleep < 6h', result: 'Trigger · 84% confidence · 21/24 days' },
                { icon: '·', iconBg: 'bg-slate-200', iconColor: 'text-slate-500', factor: 'Chocolate', result: 'No association · 72 days observed' },
                { icon: '?', iconBg: 'bg-amber-100', iconColor: 'text-amber-700', factor: 'Caffeine timing', result: 'Insufficient data · 11 days needed' },
              ].map(ex => (
                <li key={ex.factor} className="flex items-start gap-3">
                  <span className={`mt-1 inline-flex size-6 shrink-0 items-center justify-center rounded text-xs font-bold ${ex.iconBg} ${ex.iconColor}`}>
                    {ex.icon}
                  </span>
                  <div>
                    <div className="font-semibold text-foreground">{ex.factor}</div>
                    <div className="mt-0.5 text-sm text-muted-foreground">{ex.result}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── WEATHER ───────────────────────────────────────────── */}
      <section id="weather" className="scroll-mt-20 border-t border-border bg-background">
        <div className="mx-auto max-w-5xl px-5 py-16 md:py-24">
          <div className="grid gap-10 md:grid-cols-[1fr_1fr] md:items-center">
            <div className="space-y-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-primary">
                Weather & environment
              </div>
              <h2 className="font-display text-3xl font-semibold leading-tight text-foreground md:text-4xl">
                {t('weather_title')}
              </h2>
              <p className="text-lg leading-relaxed text-muted-foreground">
                {t('weather_text')}
              </p>
              <p className="text-sm text-muted-foreground">{t('weather_note')}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Barometric pressure', icon: '🌡', color: 'bg-sky-50 border-sky-200' },
                { label: 'Geomagnetic index (Kp)', icon: '🌐', color: 'bg-sky-50 border-sky-200' },
                { label: 'Weather pattern', icon: '🌦', color: 'bg-sky-50 border-sky-200' },
                { label: 'Solar / UV index', icon: '☀️', color: 'bg-sky-50 border-sky-200' },
              ].map(item => (
                <div key={item.label} className={`flex items-start gap-2.5 rounded-xl border p-3.5 ${item.color}`}>
                  <span className="text-xl leading-none">{item.icon}</span>
                  <span className="text-sm font-medium text-foreground/80">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── DOCTOR SHARING ────────────────────────────────────── */}
      <section id="sharing" className="scroll-mt-20 border-t border-border bg-card">
        <div className="mx-auto max-w-5xl px-5 py-16 md:py-24">
          <div className="grid gap-12 md:grid-cols-[1.1fr_1fr] md:items-start">
            <div className="space-y-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-primary">
                Doctor sharing
              </div>
              <h2 className="font-display text-3xl font-semibold leading-tight text-foreground md:text-4xl">
                {t('sharing_title')}
              </h2>
              <p className="text-lg leading-relaxed text-muted-foreground">
                {t('sharing_text')}
              </p>
              <p className="text-sm text-muted-foreground">{t('sharing_note')}</p>
            </div>

            <ul className="space-y-3 text-[15px]">
              {[
                { icon: '🔗', title: 'Tokenised share links', desc: 'Expiry windows you control. No clinic portal required.' },
                { icon: '📄', title: 'PDF export', desc: 'Print-ready clinical summary with ICHD-3 thresholds.' },
                { icon: '📊', title: 'Coverage shown', desc: 'Every metric shows the % of days recorded, so confidence is transparent.' },
                { icon: '🔒', title: 'Revoke any time', desc: 'One tap to expire a share link. No data retained by the recipient.' },
              ].map(item => (
                <li key={item.title} className="flex gap-3 rounded-xl border border-border bg-background p-4">
                  <span className="text-xl leading-none">{item.icon}</span>
                  <div>
                    <div className="font-semibold text-foreground">{item.title}</div>
                    <div className="mt-0.5 text-sm text-muted-foreground">{item.desc}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── COMMUNITY ─────────────────────────────────────────── */}
      <section id="community" className="scroll-mt-20 border-t border-border bg-background">
        <div className="mx-auto max-w-5xl px-5 py-16 md:py-20">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-primary">Community</div>
              <h2 className="font-display text-2xl font-semibold leading-tight text-foreground md:text-3xl">
                {t('community_title')}
              </h2>
              <p className="max-w-xl text-muted-foreground">{t('community_text')}</p>
            </div>
            <Link
              href="/community"
              className={buttonVariants({ variant: 'outline', size: 'lg' })}
            >
              {t('community_link')}
            </Link>
          </div>
        </div>
      </section>

      {/* ── PRIVACY ───────────────────────────────────────────── */}
      <section id="privacy-and-security" className="scroll-mt-20 border-t border-border bg-card">
        <div className="mx-auto max-w-5xl px-5 py-16 md:grid md:grid-cols-[1.1fr_1fr] md:items-start md:gap-16 md:py-24">
          <div className="space-y-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-primary">
              Privacy & security
            </div>
            <h2 className="font-display text-3xl font-semibold leading-tight text-foreground md:text-4xl">
              {t('privacy_title')}
            </h2>
            <p className="text-lg leading-relaxed text-muted-foreground">
              {t('privacy_text')}
            </p>
          </div>

          <ul className="mt-10 space-y-4 text-[15px] md:mt-0">
            {[
              {
                n: '1',
                text: t('privacy_item1'),
                link: { label: t('privacy_item1_link'), href: 'https://clerk.com/user-authentication' },
              },
              {
                n: '2',
                text: t('privacy_item2'),
                link: { label: t('privacy_item2_link'), href: 'https://neon.com/docs/security/hipaa' },
              },
              { n: '3', text: t('privacy_item3') },
              { n: '4', text: t('privacy_item4') },
            ].map(item => (
              <li key={item.n} className="flex gap-3">
                <span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  {item.n}
                </span>
                <div className="text-muted-foreground">
                  {item.text}
                  {item.link && (
                    <>
                      {' '}
                      <Link
                        href={item.link.href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        {item.link.label}
                      </Link>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── COMPARISON TABLE ──────────────────────────────────── */}
      <section id="compare" className="scroll-mt-20 border-t border-border bg-background">
        <div className="mx-auto max-w-5xl px-5 py-16 md:py-24">
          <h2 className="font-display text-center text-3xl font-semibold text-foreground md:text-4xl">
            {t('compare_title')}
          </h2>

          <div className="mt-8 overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-5 py-3.5 text-sm font-semibold text-foreground">{t('compare_col1')}</th>
                  <th className="px-5 py-3.5 text-sm font-semibold text-muted-foreground">{t('compare_col2')}</th>
                  <th className="px-5 py-3.5 text-sm font-semibold text-primary">{t('compare_col3')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[1, 2, 3, 4, 5].map(row => (
                  <tr key={row} className="transition hover:bg-muted/30">
                    <td className="px-5 py-3.5 font-medium text-foreground">
                      {t(`compare_row${row}_col1` as any)}
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground">
                      {t(`compare_row${row}_col2` as any)}
                    </td>
                    <td className="px-5 py-3.5 text-foreground">
                      {t(`compare_row${row}_col3` as any)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────── */}
      <section className="border-t border-border bg-card">
        <div className="mx-auto max-w-3xl px-5 py-16 md:py-24">
          <h2 className="font-display text-3xl font-semibold text-foreground md:text-4xl">
            {t('faq_title')}
          </h2>

          <div className="mt-10 divide-y divide-border border-y border-border">
            {faqItems.map(item => (
              <details key={item.question} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between text-[17px] font-semibold text-foreground">
                  {item.question}
                  <ChevronDownIcon className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
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
      <section className="border-t border-border bg-gradient-to-b from-primary/5 to-background">
        <div className="mx-auto max-w-3xl px-5 py-24 text-center md:py-32">
          <h2 className="font-display text-4xl font-semibold leading-tight text-foreground md:text-5xl">
            {t('cta_title')}
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground">
            {t('cta_text')}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/sign-up" className={buttonVariants({ size: 'lg' })}>
              {t('cta_primary')}
              <ArrowRightIcon className="ml-2 size-4" />
            </Link>
            <Link href="/install" className={buttonVariants({ size: 'lg', variant: 'outline' })}>
              {t('cta_secondary')}
            </Link>
          </div>
          <p className="mt-5 text-sm text-muted-foreground">
            No credit card. No medical advice. We never sell health data.
          </p>
        </div>
      </section>

      {/* eslint-disable-next-line react/dom-no-dangerously-set-innerhtml */}
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
      <div
        aria-hidden="true"
        className="absolute left-1/2 z-10 -translate-x-1/2"
        style={{ top: 14, width: 90, height: 26, borderRadius: 999, background: '#000' }}
      />
      <div className="relative size-full overflow-hidden bg-background" style={{ borderRadius: 36 }}>
        <div className="flex items-end justify-between px-6 text-[14px] font-semibold text-foreground" style={{ height: 44, paddingBottom: 8 }}>
          <span>9:41</span>
          <span className="text-xs">●●●</span>
        </div>
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
      <div className="pb-1 pt-0.5 text-[11px] font-semibold">Migraine Club</div>
      <div className="text-[22px] font-bold leading-tight">Dashboard</div>
      <div className="text-[12px] text-muted-foreground">Welcome back, Maya</div>

      <div className="rounded-2xl border border-border bg-card p-3 shadow-sm">
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
          <button className="rounded-md bg-card py-1.5 text-foreground shadow-sm">No pain</button>
          <button className="rounded-md py-1.5 text-muted-foreground">Headache</button>
          <button className="rounded-md py-1.5 text-muted-foreground">Migraine</button>
        </div>
      </div>

      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">For today</div>
      <div className="space-y-1.5">
        {[
          { icon: '⚡', bg: 'bg-violet-100', label: 'Start attack' },
          { icon: '💊', bg: 'bg-green-100', label: 'Take medication' },
        ].map(a => (
          <div key={a.label} className="flex items-center gap-2 rounded-xl border border-border bg-card p-2.5">
            <div className={`flex size-7 items-center justify-center rounded-lg ${a.bg}`}>
              <span className="text-[10px]">{a.icon}</span>
            </div>
            <span className="text-[12px] font-medium">{a.label}</span>
          </div>
        ))}
      </div>

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

/* ── Attack log screen ──────────────────────────────────────── */
function AttackLogScreen() {
  return (
    <div className="text-foreground">
      <div className="pb-2 pt-0.5 text-[20px] font-bold leading-tight">Log attack</div>

      <div className="space-y-2">
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pain level</div>
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {[
              { n: '1', label: 'Mild', cls: 'bg-green-100 text-green-700' },
              { n: '2', label: 'Mod', cls: 'bg-amber-100 text-amber-700 ring-2 ring-amber-400 ring-offset-1' },
              { n: '3', label: 'Severe', cls: 'bg-red-100 text-red-700' },
              { n: '4', label: 'Very', cls: 'bg-red-200 text-red-800' },
            ].map(p => (
              <button key={p.n} className={`rounded-lg py-2 text-center text-[10px] font-semibold ${p.cls}`}>
                <div className="text-[13px] font-bold">{p.n}</div>
                <div>{p.label}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">When did it start?</div>
          <div className="mt-2 grid grid-cols-3 gap-1 text-[10px] font-medium">
            {['Now', '1h ago', '3h ago'].map(t => (
              <button key={t} className={`rounded-lg border py-2 text-center ${t === 'Now' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Symptoms</div>
          <div className="mt-2 flex flex-wrap gap-1">
            {['Throbbing', 'Nausea', 'Light sens.', 'Aura'].map(s => (
              <span key={s} className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${s === 'Throbbing' || s === 'Nausea' ? 'bg-primary/10 text-primary' : 'border border-border text-muted-foreground'}`}>
                {s}
              </span>
            ))}
          </div>
        </div>

        <button className="w-full rounded-xl bg-primary py-2.5 text-[12px] font-semibold text-white">
          Log attack
        </button>
      </div>
    </div>
  );
}

/* ── Diary screen ───────────────────────────────────────────── */
function DiaryScreen() {
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
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
      <div className="mb-2 text-[10px] text-muted-foreground">Daily check-in · May 2026</div>

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
            <div key={i} className={`flex aspect-square items-center justify-center rounded-[3px] text-[7px] font-medium ${cellClass[t] ?? ''}`}>
              {t !== 'pad' ? i - 2 : ''}
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

/* ── Outcomes screen ────────────────────────────────────────── */
function OutcomesScreen() {
  return (
    <div className="text-foreground">
      <div className="pb-2 pt-0.5 text-[20px] font-bold leading-tight">Outcomes</div>
      <div className="mb-2 text-[10px] text-muted-foreground">Doctor-ready summary</div>

      <div className="mb-2 flex gap-1">
        <button className="rounded-lg bg-primary px-2 py-1 text-[9px] font-semibold text-white">Current</button>
        <button className="rounded-lg border border-border bg-card px-2 py-1 text-[9px] font-medium text-muted-foreground">60d</button>
        <button className="rounded-lg border border-border bg-card px-2 py-1 text-[9px] font-medium text-muted-foreground">90d</button>
      </div>

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

      <div className="mt-2 grid grid-cols-2 gap-2">
        {[
          { label: 'HIT-6', value: '52', sub: 'moderate', subCls: 'text-amber-700', pct: '55%', barCls: 'bg-amber-500' },
          { label: 'MIDAS', value: '11', sub: 'grade II', subCls: 'text-muted-foreground', pct: '40%', barCls: 'bg-cyan-500' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-2.5">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{s.label}</div>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span className="text-[20px] font-bold tabular-nums">{s.value}</span>
              <span className={`text-[9px] font-medium ${s.subCls}`}>{s.sub}</span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
              <span className={`block h-full rounded-full ${s.barCls}`} style={{ width: s.pct }} />
            </div>
          </div>
        ))}
      </div>

      <button className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg bg-foreground py-2 text-[10px] font-semibold text-background">
        ↓ Export for doctor
      </button>
    </div>
  );
}

/* ── Small helpers ──────────────────────────────────────────── */
type DiaryColor = 'good' | 'warn' | 'bad' | 'missing';

function DiaryTypeRow({ color, label, desc }: { color: DiaryColor; label: string; desc: string }) {
  const iconMap: Record<DiaryColor, React.ReactNode> = {
    good: <span className="text-[10px] text-green-700">✓</span>,
    warn: <span className="text-[11px] font-bold text-amber-700">!</span>,
    bad: <span className="inline-block size-2 rounded-full bg-red-600" />,
    missing: null,
  };
  const bgMap: Record<DiaryColor, string> = {
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

function InsightLabel({ cardClass, labelClass, label, desc }: { cardClass: string; labelClass: string; label: string; desc: string }) {
  return (
    <div className={`rounded-2xl border p-5 ${cardClass}`}>
      <div className={`text-xs font-semibold uppercase tracking-wider ${labelClass}`}>{label}</div>
      <p className="mt-2 text-sm leading-relaxed text-foreground/80">{desc}</p>
    </div>
  );
}

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

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

export default ProductPage;
