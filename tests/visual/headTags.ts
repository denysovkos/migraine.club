/** The metadata tags of a <head>: no scripts, styles or bundle preloads. */
export function headTags(html: string): string[] {
  const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? '';
  return (head.match(/<(?:meta|link)\b[^>]*>|<title\b[^>]*>[\s\S]*?<\/title>/g) ?? [])
    .filter(tag => !/rel="(?:stylesheet|preload|modulepreload|expect)"|\/_next\/|\/assets\/|name="next-size-adjust"/.test(tag));
}
