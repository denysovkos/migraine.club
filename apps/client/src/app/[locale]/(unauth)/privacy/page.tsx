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
    title: t('privacy_meta_title'),
    description: t('privacy_meta_description'),
    alternates: getPageAlternates((await props.params).locale, '/privacy'),
    openGraph: {
      title: t('privacy_meta_title'),
      description: t('privacy_meta_description'),
      url: getPageAlternates((await props.params).locale, '/privacy').canonical,
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: t('privacy_meta_og_alt'),
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: t('privacy_meta_title'),
      description: t('privacy_meta_description'),
      images: [ogImage],
    },
  };
}

const PrivacyPolicyPage = async (props: { params: Promise<{ locale: string }> }) => {
  setRequestLocale((await props.params).locale);
  const t = await getTranslations('Legal');

  const tocItems = [
    { id: 'summary', label: t('privacy_toc_summary') },
    { id: 'controller', label: t('privacy_toc_controller') },
    { id: 'data', label: t('privacy_toc_data') },
    { id: 'legal', label: t('privacy_toc_legal') },
    { id: 'processors', label: t('privacy_toc_processors') },
    { id: 'hipaa', label: t('privacy_toc_hipaa') },
    { id: 'security', label: t('privacy_toc_security') },
    { id: 'retention', label: t('privacy_toc_retention') },
    { id: 'rights', label: t('privacy_toc_rights') },
    { id: 'transfers', label: t('privacy_toc_transfers') },
    { id: 'contact', label: t('privacy_toc_contact') },
  ];

  return (
    <>
      <Navbar />

      <Section className="pb-10 pt-16">
        <div className="mx-auto grid max-w-screen-lg gap-10 lg:grid-cols-[1fr_260px]">
          <article className="prose prose-slate dark:prose-invert max-w-none">
            <h1>{t('privacy_title')}</h1>
            <p className="text-sm text-muted-foreground">
              {t('last_updated')}
              :
              {' '}
              {t('privacy_last_updated')}
            </p>

            <section id="summary">
              <h2>{t('privacy_summary_title')}</h2>
              <p>{t('privacy_summary_text')}</p>
            </section>

            <section id="controller">
              <h2>{t('privacy_controller_title')}</h2>
              <p>{t('privacy_controller_text')}</p>
              <address className="not-italic">
                <strong>{t('privacy_controller_company')}</strong>
                <br />
                {t('privacy_controller_line1')}
                <br />
                {t('privacy_controller_line2')}
                <br />
                {t('privacy_controller_line3')}
              </address>
            </section>

            <section id="data">
              <h2>{t('privacy_data_title')}</h2>
              <h3>{t('privacy_data_account_title')}</h3>
              <p>{t('privacy_data_account_text')}</p>
              <h3>{t('privacy_data_health_title')}</h3>
              <p>{t('privacy_data_health_text')}</p>
              <h3>{t('privacy_data_technical_title')}</h3>
              <p>{t('privacy_data_technical_text')}</p>
              <h3>{t('privacy_data_community_title')}</h3>
              <p>{t('privacy_data_community_text')}</p>
            </section>

            <section id="legal">
              <h2>{t('privacy_legal_title')}</h2>
              <ul>
                <li>{t('privacy_legal_item1')}</li>
                <li>{t('privacy_legal_item2')}</li>
                <li>{t('privacy_legal_item3')}</li>
              </ul>
              <p>{t('privacy_legal_consent')}</p>
            </section>

            <section id="processors">
              <h2>{t('privacy_processors_title')}</h2>
              <p>{t('privacy_processors_text')}</p>
              <ul>
                <li>
                  {t('privacy_processors_item1')}
                  {' '}
                  <Link href="https://neon.com/docs/security/hipaa" className="text-primary hover:underline">
                    {t('privacy_processors_item1_link')}
                  </Link>
                </li>
                <li>
                  {t('privacy_processors_item2')}
                  {' '}
                  <Link href="https://clerk.com/user-authentication" className="text-primary hover:underline">
                    {t('privacy_processors_item2_link')}
                  </Link>
                </li>
                <li>{t('privacy_processors_item3')}</li>
                <li>{t('privacy_processors_item4')}</li>
              </ul>
              <p>{t('privacy_processors_note')}</p>
            </section>

            <section id="hipaa">
              <h2>{t('privacy_hipaa_title')}</h2>
              <p>
                {t('privacy_hipaa_text')}
                {' '}
                <Link href="https://neon.com/blog/hipaa" className="text-primary hover:underline">
                  {t('privacy_hipaa_link')}
                </Link>
                .
              </p>
              <p>{t('privacy_hipaa_shared')}</p>
            </section>

            <section id="security">
              <h2>{t('privacy_security_title')}</h2>
              <ul>
                <li>{t('privacy_security_item1')}</li>
                <li>{t('privacy_security_item2')}</li>
                <li>{t('privacy_security_item3')}</li>
                <li>{t('privacy_security_item4')}</li>
              </ul>
            </section>

            <section id="retention">
              <h2>{t('privacy_retention_title')}</h2>
              <ul>
                <li>{t('privacy_retention_item1')}</li>
                <li>{t('privacy_retention_item2')}</li>
                <li>{t('privacy_retention_item3')}</li>
              </ul>
            </section>

            <section id="rights">
              <h2>{t('privacy_rights_title')}</h2>
              <p>{t('privacy_rights_text')}</p>
              <ul>
                <li>{t('privacy_rights_item1')}</li>
                <li>{t('privacy_rights_item2')}</li>
                <li>{t('privacy_rights_item3')}</li>
                <li>{t('privacy_rights_item4')}</li>
                <li>{t('privacy_rights_item5')}</li>
                <li>{t('privacy_rights_item6')}</li>
                <li>{t('privacy_rights_item7')}</li>
              </ul>
              <p>{t('privacy_rights_note')}</p>
            </section>

            <section id="transfers">
              <h2>{t('privacy_transfers_title')}</h2>
              <p>{t('privacy_transfers_text')}</p>
            </section>

            <section id="contact">
              <h2>{t('privacy_contact_title')}</h2>
              <p>
                {t('privacy_contact_text')}
                {' '}
                <a href="mailto:support@migraine.club">support@migraine.club</a>
              </p>
            </section>
          </article>

          <aside className="hidden lg:block">
            <div className="sticky top-24 rounded-2xl border bg-card p-4 text-sm">
              <p className="font-semibold">{t('privacy_toc_title')}</p>
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

export default PrivacyPolicyPage;
