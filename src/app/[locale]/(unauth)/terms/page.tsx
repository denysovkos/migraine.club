import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';

import { Section } from '@/features/landing/Section';
import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';
import { getAbsoluteUrl, getPageAlternates } from '@/utils/seo';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({
    locale: (await props.params).locale,
    namespace: 'Legal',
  });

  const ogImage = getAbsoluteUrl('/og-migraine-club.svg');

  return {
    title: t('terms_meta_title'),
    description: t('terms_meta_description'),
    alternates: getPageAlternates((await props.params).locale, '/terms'),
    openGraph: {
      title: t('terms_meta_title'),
      description: t('terms_meta_description'),
      url: getPageAlternates((await props.params).locale, '/terms').canonical,
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: t('terms_meta_og_alt'),
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: t('terms_meta_title'),
      description: t('terms_meta_description'),
      images: [ogImage],
    },
  };
}

const TermsOfUsePage = async (props: { params: Promise<{ locale: string }> }) => {
  setRequestLocale((await props.params).locale);
  const t = await getTranslations('Legal');

  const tocItems = [
    { id: 'service', label: t('terms_toc_service') },
    { id: 'eligibility', label: t('terms_toc_eligibility') },
    { id: 'accounts', label: t('terms_toc_accounts') },
    { id: 'acceptable-use', label: t('terms_toc_acceptable_use') },
    { id: 'community', label: t('terms_toc_community') },
    { id: 'content', label: t('terms_toc_content') },
    { id: 'privacy', label: t('terms_toc_privacy') },
    { id: 'disclaimers', label: t('terms_toc_disclaimers') },
    { id: 'liability', label: t('terms_toc_liability') },
    { id: 'termination', label: t('terms_toc_termination') },
    { id: 'changes', label: t('terms_toc_changes') },
    { id: 'law', label: t('terms_toc_law') },
    { id: 'contact', label: t('terms_toc_contact') },
  ];

  return (
    <>
      <Navbar />

      <Section className="pb-10 pt-16">
        <div className="mx-auto grid max-w-screen-lg gap-10 lg:grid-cols-[1fr_260px]">
          <article className="prose prose-slate dark:prose-invert max-w-none">
            <h1>{t('terms_title')}</h1>
            <p className="text-sm text-muted-foreground">
              {t('last_updated')}
              :
              {' '}
              {t('terms_last_updated')}
            </p>

            <section id="service">
              <h2>{t('terms_service_title')}</h2>
              <p>{t('terms_service_text')}</p>
              <p>{t('terms_service_controller')}</p>
            </section>

            <section id="eligibility">
              <h2>{t('terms_eligibility_title')}</h2>
              <p>{t('terms_eligibility_text')}</p>
            </section>

            <section id="accounts">
              <h2>{t('terms_accounts_title')}</h2>
              <p>{t('terms_accounts_text')}</p>
              <p>
                {t('terms_accounts_consent')}
                {' '}
                <Link
                  href="https://clerk.com/docs/guides/secure/legal-compliance"
                  className="text-primary hover:underline"
                >
                  {t('terms_accounts_consent_link')}
                </Link>
                .
              </p>
            </section>

            <section id="acceptable-use">
              <h2>{t('terms_use_title')}</h2>
              <ul>
                <li>{t('terms_use_item1')}</li>
                <li>{t('terms_use_item2')}</li>
                <li>{t('terms_use_item3')}</li>
                <li>{t('terms_use_item4')}</li>
              </ul>
            </section>

            <section id="community">
              <h2>{t('terms_community_title')}</h2>
              <p>{t('terms_community_text')}</p>
              <ul>
                <li>{t('terms_community_item1')}</li>
                <li>{t('terms_community_item2')}</li>
                <li>{t('terms_community_item3')}</li>
                <li>{t('terms_community_item4')}</li>
              </ul>
            </section>

            <section id="content">
              <h2>{t('terms_content_title')}</h2>
              <p>{t('terms_content_text')}</p>
            </section>

            <section id="privacy">
              <h2>{t('terms_privacy_title')}</h2>
              <p>
                {t('terms_privacy_text')}
                {' '}
                <Link href="/privacy" className="text-primary hover:underline">
                  {t('terms_privacy_link')}
                </Link>
                .
              </p>
            </section>

            <section id="disclaimers" className="rounded-lg border-2 border-amber-500 bg-amber-50 p-4 dark:bg-amber-950/20">
              <h2 className="text-amber-700 dark:text-amber-400">{t('terms_disclaimer_title')}</h2>
              <p className="font-semibold">{t('terms_disclaimer_text')}</p>
              <ul>
                <li>{t('terms_disclaimer_item1')}</li>
                <li>{t('terms_disclaimer_item2')}</li>
                <li>{t('terms_disclaimer_item3')}</li>
              </ul>
              <p>{t('terms_disclaimer_emergency')}</p>
            </section>

            <section id="liability">
              <h2>{t('terms_liability_title')}</h2>
              <p>{t('terms_liability_text')}</p>
              <ul>
                <li>{t('terms_liability_item1')}</li>
                <li>{t('terms_liability_item2')}</li>
                <li>{t('terms_liability_item3')}</li>
              </ul>
            </section>

            <section id="termination">
              <h2>{t('terms_termination_title')}</h2>
              <p>{t('terms_termination_text')}</p>
            </section>

            <section id="changes">
              <h2>{t('terms_changes_title')}</h2>
              <p>{t('terms_changes_text')}</p>
            </section>

            <section id="law">
              <h2>{t('terms_law_title')}</h2>
              <p>{t('terms_law_text')}</p>
            </section>

            <section id="contact">
              <h2>{t('terms_contact_title')}</h2>
              <p>
                {t('terms_contact_text')}
                {' '}
                <a href="mailto:support@migraine.club">support@migraine.club</a>
              </p>
            </section>
          </article>

          <aside className="hidden lg:block">
            <div className="sticky top-24 rounded-2xl border bg-card p-4 text-sm">
              <p className="font-semibold">{t('terms_toc_title')}</p>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                {tocItems.map(item => (
                  <li key={item.id}>
                    <a href={`#${item.id}`} className="hover:text-foreground">
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </Section>

      <Footer />
    </>
  );
};

export default TermsOfUsePage;
