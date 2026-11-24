// Use type safe message keys with `next-intl`
type Messages = typeof import('@migraine/locales/en.json');

// eslint-disable-next-line ts/consistent-type-definitions
declare interface IntlMessages extends Messages {}
