import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AiConnectorGuide } from '@/features/help/AiConnectorGuide';
import { Section } from '@/features/landing/Section';
import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';
import { getAbsoluteUrl, getPageAlternates } from '@/utils/seo';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = (await props.params).locale;
  const t = await getTranslations({ locale, namespace: 'HelpAiConnector' });
  const alternates = getPageAlternates(locale, '/mcp');

  return {
    title: t('meta_title'),
    description: t('meta_description'),
    keywords: ['MCP', 'Model Context Protocol', 'Claude', 'MCP server', 'AI connector', 'migraine tracker'],
    alternates,
    openGraph: {
      title: t('meta_title'),
      description: t('meta_description'),
      url: alternates.canonical,
      type: 'article',
    },
    twitter: {
      title: t('meta_title'),
      description: t('meta_description'),
    },
  };
}

export default async function McpPage(props: { params: Promise<{ locale: string }> }) {
  const locale = (await props.params).locale;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'HelpAiConnector' });

  // HowTo markup: this page is a setup guide, so the step list is the part
  // worth exposing to search engines.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    'name': t('meta_title'),
    'description': t('meta_description'),
    'url': getAbsoluteUrl('/mcp'),
    'step': [1, 2, 3, 4, 5].map((n, index) => ({
      '@type': 'HowToStep',
      'position': index + 1,
      'name': t(`step${n}_title` as 'step1_title'),
      'text': t(`step${n}_body` as 'step1_body'),
    })),
  };

  return (
    <>
      <Navbar />
      <Section className="py-10">
        <div className="mx-auto max-w-2xl">
          <AiConnectorGuide />
        </div>
      </Section>
      <Footer />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </>
  );
}
