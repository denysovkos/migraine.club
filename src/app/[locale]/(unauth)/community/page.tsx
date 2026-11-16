import { CheckCircle, MessageCircle, ShieldCheck, Stethoscope, UserCheck, Users } from 'lucide-react';

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
    namespace: 'CommunityPage',
  });

  const ogImage = getAbsoluteUrl('/og-migraine-club.svg');

  return {
    title: t('meta_title'),
    description: t('meta_description'),
    alternates: getPageAlternates((await props.params).locale, '/community'),
    openGraph: {
      title: t('meta_title'),
      description: t('meta_description'),
      url: getPageAlternates((await props.params).locale, '/community').canonical,
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

const CommunityPage = async (props: { params: Promise<{ locale: string }> }) => {
  setRequestLocale((await props.params).locale);
  return (
    <>
      <Navbar />
      <CommunityContent />
      <Footer />
    </>
  );
};

async function CommunityContent() {
  const t = await getTranslations('CommunityPage');

  return (
    <main className={`pb-24 md:pb-0 ${fraunces.variable}`}>

      {/* ── HERO ──────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div aria-hidden="true" className="pointer-events-none absolute -right-32 -top-40 size-[540px] rounded-full bg-primary/10 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -left-40 top-60 size-[400px] rounded-full bg-emerald-500/10 blur-3xl" />

        <div className="relative mx-auto max-w-5xl px-5 pb-16 pt-14 text-center md:pb-20 md:pt-24">
          <div className="shadow-soft inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Free to join · Anonymous by default
          </div>

          <h1 className="font-display mt-6 text-[40px] font-semibold leading-[1.05] tracking-tight text-foreground sm:text-[52px] md:text-[64px]">
            {t('hero_title')}
          </h1>

          <p className="mx-auto mt-5 max-w-[52ch] text-lg leading-relaxed text-muted-foreground">
            {t('hero_subtitle')}
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/sign-up" className={buttonVariants({ size: 'lg' })}>
              {t('hero_primary_cta')}
            </Link>
            <Link href="/sign-up" className={buttonVariants({ size: 'lg', variant: 'outline' })}>
              {t('hero_secondary_cta')}
            </Link>
          </div>

          {/* Community preview card */}
          <div className="shadow-soft mx-auto mt-14 max-w-md overflow-hidden rounded-2xl border border-border bg-card text-left">
            <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-3">
              <div className="flex gap-1.5">
                <div className="size-2.5 rounded-full bg-red-400/60" />
                <div className="size-2.5 rounded-full bg-amber-400/60" />
                <div className="size-2.5 rounded-full bg-emerald-400/60" />
              </div>
              <span className="ml-1 text-xs text-muted-foreground">Community · Pinned</span>
            </div>

            <div className="divide-y divide-border">
              {[
                { label: 'Anonymous member', time: '2h ago', text: 'Anyone else find that HIT-6 scores actually match how I feel? My neurologist was surprised by how low mine dropped after changing my preventive.', votes: 47 },
                { label: 'Verified neurologist', time: '1h ago', badge: true, text: 'HIT-6 captures functional impact really well. A 6-point change is clinically meaningful.', votes: 38 },
                { label: 'Member', time: '45m ago', text: 'This is exactly what I needed to show my doctor.', votes: 22 },
              ].map(post => (
                <div key={post.label} className="flex gap-3 px-4 py-3">
                  <div className="flex flex-col items-center pt-0.5">
                    <div className="flex size-7 items-center justify-center rounded-full bg-primary/10">
                      {post.badge
                        ? <Stethoscope className="size-3.5 text-primary" />
                        : <Users className="size-3.5 text-muted-foreground" />}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-foreground">{post.label}</span>
                      {post.badge && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                          Verified MD
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground/60">{post.time}</span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{post.text}</p>
                    <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground/50">
                      <span>▲</span>
                      <span>{post.votes}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── WHY IT'S DIFFERENT ────────────────────────────────── */}
      <section className="border-t border-border bg-card">
        <div className="mx-auto max-w-5xl px-5 py-16 md:py-20">
          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                icon: <MessageCircle className="size-5 text-emerald-600" />,
                bg: 'bg-emerald-50',
                label: 'Calm pace',
                desc: 'No likes, no notifications by default. Engage when you have capacity — not because an algorithm pushed something at you.',
              },
              {
                icon: <ShieldCheck className="size-5 text-primary" />,
                bg: 'bg-primary/10',
                label: 'Safe by design',
                desc: 'Moderated discussions, zero tolerance for harassment, and easy reporting. Medical advice is clearly separated from lived experience.',
              },
              {
                icon: <Stethoscope className="size-5 text-violet-600" />,
                bg: 'bg-violet-50',
                label: 'Expert-backed',
                desc: 'Verified clinicians answer questions and flag misinformation. A badge you can trust, not just a username.',
              },
            ].map(item => (
              <div key={item.label} className="rounded-2xl border border-border bg-background p-6">
                <div className={`inline-flex size-10 items-center justify-center rounded-xl ${item.bg}`}>
                  {item.icon}
                </div>
                <h3 className="mt-4 font-semibold text-foreground">{item.label}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SAFETY ────────────────────────────────────────────── */}
      <section className="border-t border-border bg-background">
        <div className="mx-auto max-w-5xl px-5 py-16 md:py-24">
          <h2 className="font-display text-3xl font-semibold text-foreground md:text-5xl">
            {t('safety_title')}
          </h2>
          <p className="mt-4 max-w-[52ch] text-lg text-muted-foreground">
            Migraine communities can attract pseudoscience and bad advice.
            We actively prevent that.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {[
              { title: t('safety_item1_title'), text: t('safety_item1_text'), color: 'text-emerald-600', bg: 'bg-emerald-50' },
              { title: t('safety_item2_title'), text: t('safety_item2_text'), color: 'text-red-600', bg: 'bg-red-50' },
              { title: t('safety_item3_title'), text: t('safety_item3_text'), color: 'text-amber-600', bg: 'bg-amber-50' },
              { title: t('safety_item4_title'), text: t('safety_item4_text'), color: 'text-primary', bg: 'bg-primary/10' },
            ].map(item => (
              <div key={item.title} className="flex gap-4 rounded-2xl border border-border bg-card p-5">
                <div className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full ${item.bg}`}>
                  <ShieldCheck className={`size-4 ${item.color}`} />
                </div>
                <div>
                  <div className="font-semibold text-foreground">{item.title}</div>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ANONYMOUS ─────────────────────────────────────────── */}
      <section className="border-t border-border bg-card">
        <div className="mx-auto max-w-5xl px-5 py-16 md:py-24">
          <div className="md:grid md:grid-cols-2 md:items-center md:gap-16">
            <div className="space-y-5">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground">
                <ShieldCheck className="size-3.5 text-primary" />
                Privacy by default
              </div>
              <h2 className="font-display text-3xl font-semibold text-foreground md:text-4xl">
                {t('anonymous_title')}
              </h2>
              <p className="text-base leading-relaxed text-muted-foreground">
                {t('anonymous_text')}
              </p>
              <ul className="space-y-3">
                {[
                  'Post under a display name — not your real name',
                  'Change visibility at any time',
                  'No profile linking across your diary data',
                  'You control what you share and with whom',
                ].map(item => (
                  <li key={item} className="flex items-start gap-2.5 text-sm">
                    <CheckCircle className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                    <span className="text-foreground/80">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Visual: anonymous post card */}
            <div className="mt-10 md:mt-0">
              <div className="shadow-soft space-y-3 rounded-2xl border border-border bg-background p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex size-8 items-center justify-center rounded-full bg-primary/15">
                      <Users className="size-4 text-primary" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-foreground">Anonymous member</div>
                      <div className="text-xs text-muted-foreground/60">Your real name is never shown</div>
                    </div>
                  </div>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                    Anonymous
                  </span>
                </div>
                <div className="rounded-xl bg-muted/40 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
                  "Does anyone else track weather correlation? I noticed my attacks spike when barometric pressure drops fast."
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground/50">
                  <span>▲ 31 votes</span>
                  <span>· 8 replies</span>
                  <span>· 3h ago</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── DOCTORS ───────────────────────────────────────────── */}
      <section className="border-t border-border bg-background">
        <div className="mx-auto max-w-5xl px-5 py-16 md:py-24">
          <div className="md:grid md:grid-cols-2 md:items-center md:gap-16">
            {/* Visual: verified doctor answer */}
            <div className="shadow-soft space-y-4 rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center gap-2 border-b border-border pb-3 text-xs text-muted-foreground">
                <Stethoscope className="size-3.5 text-primary" />
                <span className="font-medium">Clinician answer</span>
              </div>
              <div className="flex gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Stethoscope className="size-4 text-primary" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">Dr. Sarah K.</span>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      Verified Neurologist
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    "Barometric pressure changes are a well-documented trigger for some patients. Tracking it systematically alongside attack logs — exactly what Migrennity helps with — can give your neurologist something concrete to work with."
                  </p>
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-700">
                    General education only — not individual medical advice.
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-10 space-y-5 md:mt-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground">
                <UserCheck className="size-3.5 text-primary" />
                Verified credentials
              </div>
              <h2 className="font-display text-3xl font-semibold text-foreground md:text-4xl">
                {t('doctors_title')}
              </h2>
              <p className="text-base leading-relaxed text-muted-foreground">
                {t('doctors_text')}
              </p>
              <div className="inline-flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <div className="flex size-6 shrink-0 items-center justify-center rounded-full border border-amber-300 bg-amber-100 text-xs font-bold">
                  !
                </div>
                <span className="font-medium">{t('doctors_note')}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FEATURES ──────────────────────────────────────────── */}
      <section className="border-t border-border bg-card">
        <div className="mx-auto max-w-5xl px-5 py-16 md:py-24">
          <h2 className="font-display text-3xl font-semibold text-foreground md:text-4xl">
            {t('features_title')}
          </h2>

          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {[
              { icon: <MessageCircle className="size-4 text-foreground/60" />, title: t('features_item1_title'), text: t('features_item1_text') },
              { icon: <UserCheck className="size-4 text-foreground/60" />, title: t('features_item2_title'), text: t('features_item2_text') },
              { icon: <ShieldCheck className="size-4 text-foreground/60" />, title: t('features_item3_title'), text: t('features_item3_text') },
              { icon: <Users className="size-4 text-foreground/60" />, title: t('features_item4_title'), text: t('features_item4_text') },
            ].map(item => (
              <div key={item.title} className="flex gap-4 rounded-2xl border border-border bg-background p-5">
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
                  {item.icon}
                </div>
                <div>
                  <div className="font-semibold text-foreground">{item.title}</div>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────── */}
      <section className="border-t border-border bg-gradient-to-b from-primary/5 to-background">
        <div className="mx-auto max-w-3xl px-5 py-24 text-center md:py-32">
          <h2 className="font-display text-4xl font-semibold leading-[1.05] text-foreground md:text-5xl">
            {t('cta_title')}
          </h2>
          <p className="mx-auto mt-4 max-w-md text-lg text-muted-foreground">
            {t('cta_text')}
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/sign-up" className={buttonVariants({ size: 'lg' })}>
              {t('cta_primary')}
            </Link>
            <Link href="/sign-up" className={buttonVariants({ size: 'lg', variant: 'outline' })}>
              {t('cta_secondary')}
            </Link>
          </div>
        </div>
      </section>

    </main>
  );
}

export default CommunityPage;
