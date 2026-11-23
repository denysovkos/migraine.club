// next/font/google: the classes the Next build generated (fonts.generated.*).
// Next shipped a font's @font-face rules only with the routes whose modules
// called it, so pages without it (admin, share) rendered in the fallback
// font. The rules of a family go into the document on its first call.
import { FONTS } from './fonts.generated';
import css from './fonts.generated.css?inline';

type Font = { className: string; variable: string; style: { fontFamily: string; fontStyle: string } };

/** The rules of one family: its @font-face blocks (and its fallback's) and its classes. */
export function rulesOf(source: string, name: keyof typeof FONTS): string[] {
  const { className, variable } = FONTS[name];
  const rules = source.match(/@font-face\s*\{[^}]*\}|\.[\w-]+\s*\{[^}]*\}/g) ?? [];
  return rules.filter((rule) => {
    if (rule.startsWith('@font-face')) {
      const family = /font-family:([^;]+);/.exec(rule)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
      return family === name || family === `${name} Fallback`;
    }
    return rule.startsWith(`.${className}`) || rule.startsWith(`.${variable}`);
  });
}

const injected = new Set<string>();

function inject(name: keyof typeof FONTS) {
  if (injected.has(name) || typeof document === 'undefined') {
    return;
  }
  injected.add(name);
  const style = document.createElement('style');
  style.dataset.font = name;
  style.textContent = rulesOf(css, name).join('\n');
  document.head.appendChild(style);
}

function font(name: keyof typeof FONTS) {
  return (_options?: unknown): Font => {
    inject(name);
    return {
      className: FONTS[name].className,
      variable: FONTS[name].variable,
      style: { fontFamily: FONTS[name].fontFamily, fontStyle: 'normal' },
    };
  };
}

export const Inter = font('Inter');
export const Fraunces = font('Fraunces');
