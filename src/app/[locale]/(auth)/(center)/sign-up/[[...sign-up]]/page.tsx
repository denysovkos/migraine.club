import { SignUp } from '@clerk/nextjs';
import { getTranslations } from 'next-intl/server';
import Script from 'next/script';

import { getI18nPath } from '@/utils/Helpers';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata(props: Props) {
  const params = await props.params;

  const {
    locale,
  } = params;

  const t = await getTranslations({
    locale,
    namespace: 'SignUp',
  });

  return {
    title: t('meta_title'),
    description: t('meta_description'),
    robots: {
      index: false,
      follow: false,
    },
  };
}

export default async function SignUpPage(props: Props) {
  const params = await props.params;

  const {
    locale,
  } = params;

  return (
    <>
      {/* eslint-disable-next-line react/dom-no-dangerously-set-innerhtml */}
      <Script
        id="google-ads-conversion-signup"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            function gtag_report_conversion(url) {
              var callback = function () {
                if (typeof url !== 'undefined') {
                  window.location = url;
                }
              };
              if (typeof gtag === 'function') {
                gtag('event', 'conversion', {
                  'send_to': 'AW-990200645/gP4NCMTSqb4aEMWGldgD',
                  'value': 1.0,
                  'currency': 'UAH',
                  'event_callback': callback
                });
              }
              return false;
            }

            // If you want it as a page-view conversion, fire it immediately:
            gtag_report_conversion();
          `,
        }}
      />

      <SignUp path={getI18nPath('/sign-up', locale)} />
    </>
  );
}
