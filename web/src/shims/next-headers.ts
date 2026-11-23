// next/headers in the browser: the request headers a page can still know.
export async function headers(): Promise<Headers> {
  return new Headers({ 'user-agent': navigator.userAgent, 'accept-language': navigator.language });
}
