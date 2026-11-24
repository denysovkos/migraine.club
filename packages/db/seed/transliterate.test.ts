import { describe, expect, it } from 'vitest';

import { containsCyrillic, cyrillicToLatin, cyrillicToLatinVariants } from './transliterate';

describe('transliterate', () => {
  it('detects cyrillic', () => {
    expect(containsCyrillic('ібупрофен')).toBe(true);
    expect(containsCyrillic('ibuprofen')).toBe(false);
  });

  it('transliterates common Ukrainian letters for search', () => {
    expect(cyrillicToLatin('ібупрофен')).toBe('ibuprofen');
    expect(cyrillicToLatin('нурофен')).toBe('nurofen');
    expect(cyrillicToLatin('МАРІТАБ маркаїн')).toBe('maritab markayin');
  });

  it('generates variants to match pharma latin spellings (g/h)', () => {
    const vars = cyrillicToLatinVariants('золміг');

    expect(vars).toContain('zolmig');
    expect(vars).toContain('zolmih');
  });
});
