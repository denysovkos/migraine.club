export function containsCyrillic(input: string): boolean {
  return /[\u0400-\u04FF]/.test(input);
}

/**
 * Best-effort UA/RU Cyrillic -> Latin transliteration for search.
 * This is intentionally simple: it is used to generate an additional query string
 * for fuzzy search, not for official transliteration.
 */
export function cyrillicToLatinVariants(input: string, maxVariants = 4): string[] {
  // "Pharma-friendly" defaults: prefer g (not h) and i (not y),
  // but generate alternates too for better matching.
  const map: Record<string, string> = {
    'а': 'a',
    'б': 'b',
    'в': 'v',
    'ґ': 'g',
    'д': 'd',
    'е': 'e',
    'є': 'ye',
    'ж': 'zh',
    'з': 'z',
    'і': 'i',
    'ї': 'yi',
    'к': 'k',
    'л': 'l',
    'м': 'm',
    'н': 'n',
    'о': 'o',
    'п': 'p',
    'р': 'r',
    'с': 's',
    'т': 't',
    'у': 'u',
    'ф': 'f',
    'х': 'kh',
    'ц': 'ts',
    'ч': 'ch',
    'ш': 'sh',
    'щ': 'shch',
    'ю': 'yu',
    'я': 'ya',
    'ь': '',
    'ъ': '',
    '’': '',
    '\'': '',

    // Russian extras
    'ё': 'yo',
    'э': 'e',
  };

  // Branching letters
  const branches: Record<string, string[]> = {
    г: ['g', 'h'],
    и: ['i', 'y'],
    й: ['i', 'y'],
  };

  let variants: string[] = [''];
  for (const rawCh of input.toLowerCase()) {
    const ch = rawCh;
    const opts = branches[ch] ?? [map[ch] ?? ch];

    const next: string[] = [];
    for (const v of variants) {
      for (const o of opts) {
        next.push(v + o);
        if (next.length >= maxVariants) {
          break;
        }
      }
      if (next.length >= maxVariants) {
        break;
      }
    }
    variants = next;
  }

  const cleaned = variants
    .map(v => v.replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  return [...new Set(cleaned)].slice(0, maxVariants);
}

export function cyrillicToLatin(input: string): string {
  return cyrillicToLatinVariants(input, 1)[0] ?? '';
}
