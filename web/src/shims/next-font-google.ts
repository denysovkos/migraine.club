// next/font/google: the classes the Next build generated (fonts.generated.*).
import { FONTS } from './fonts.generated';
import './fonts.generated.css';

type Font = { className: string; variable: string; style: { fontFamily: string; fontStyle: string } };

function font(name: keyof typeof FONTS) {
  return (_options?: unknown): Font => ({
    className: FONTS[name].className,
    variable: FONTS[name].variable,
    style: { fontFamily: FONTS[name].fontFamily, fontStyle: 'normal' },
  });
}

export const Inter = font('Inter');
export const Fraunces = font('Fraunces');
