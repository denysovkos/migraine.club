'use client';

import type { SupportedLanguageType } from '@migraine/db/schema';
import enMessages from '@migraine/locales/en.json';

import frMessages from '@migraine/locales/fr.json';
import ukMessages from '@migraine/locales/uk.json';
import { NextIntlClientProvider } from 'next-intl';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

type MessagesType = typeof enMessages;

const messagesMap: Record<SupportedLanguageType, MessagesType> = {
  en: enMessages,
  fr: frMessages,
  uk: ukMessages,
};

type ShareLocaleContextType = {
  locale: SupportedLanguageType;
  setLocale: (locale: SupportedLanguageType) => void;
};

const ShareLocaleContext = createContext<ShareLocaleContextType>({
  locale: 'en',
  setLocale: () => {},
});

/**
 * Hook to access and change the share view locale
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useShareLocale() {
  return useContext(ShareLocaleContext);
}

/**
 * Provider for internationalization in the share view.
 * Allows dynamic locale switching without page reload.
 */
export function ShareIntlProvider({
  children,
  defaultLocale = 'en',
}: {
  children: React.ReactNode;
  defaultLocale?: SupportedLanguageType;
}) {
  const [locale, setLocaleState] = useState<SupportedLanguageType>(defaultLocale);

  const setLocale = useCallback((newLocale: SupportedLanguageType) => {
    if (messagesMap[newLocale]) {
      setLocaleState(newLocale);
    }
  }, []);

  const contextValue = useMemo(() => ({
    locale,
    setLocale,
  }), [locale, setLocale]);

  const messages = messagesMap[locale] || enMessages;

  return (
    <ShareLocaleContext.Provider value={contextValue}>
      <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
        {children}
      </NextIntlClientProvider>
    </ShareLocaleContext.Provider>
  );
}
