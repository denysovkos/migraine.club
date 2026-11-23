import { afterEach, describe, expect, it } from 'vitest';

import { FONTS } from './fonts.generated';
import { Fraunces, Inter, rulesOf } from './next-font-google';

const css = `
@font-face { font-family: Inter; src: url(a.woff2); }
@font-face { font-family: Inter Fallback; src: local("Arial"); }
@font-face { font-family: Fraunces; src: url(b.woff2); }
.${FONTS.Inter.className} { font-family: Inter, Inter Fallback; }
.${FONTS.Inter.variable} { --font-inter: "Inter"; }
.${FONTS.Fraunces.className} { font-family: Fraunces; }
`;

describe('next/font shim', () => {
  afterEach(() => {
    document.head.querySelectorAll('style[data-font]').forEach(n => n.remove());
  });

  it('picks one family\'s faces, fallback and classes', () => {
    const rules = rulesOf(css, 'Inter');

    expect(rules).toHaveLength(4);
    expect(rules.join('\n')).not.toContain('Fraunces');
  });

  it('adds a family\'s rules to the document on first use only', () => {
    expect(document.head.querySelector('style[data-font]')).toBeNull();

    const inter = Inter({ subsets: ['latin'] });
    Inter({ subsets: ['latin'] });

    expect(inter.className).toBe(FONTS.Inter.className);
    expect(document.head.querySelectorAll('style[data-font="Inter"]')).toHaveLength(1);
    expect(document.head.querySelector('style[data-font="Fraunces"]')).toBeNull();

    Fraunces();

    expect(document.head.querySelectorAll('style[data-font="Fraunces"]')).toHaveLength(1);
  });
});
