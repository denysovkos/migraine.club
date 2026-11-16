'use client';

import { useLocale } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { usePathname, useRouter } from '@/libs/i18nNavigation';
import { AppConfig } from '@/utils/AppConfig';

export const LocaleSwitcher = () => {
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();

  const handleChange = (value: string) => {
    router.push(pathname, { locale: value });
  };

  const currentLocale = AppConfig.locales.find(l => l.id === locale);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="p-2 focus-visible:ring-offset-0" variant="ghost" size="icon" aria-label="lang-switcher">
          <span className="text-xl">{currentLocale?.flag ?? '🌐'}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuRadioGroup value={locale} onValueChange={handleChange}>
          {AppConfig.locales.map(elt => (
            <DropdownMenuRadioItem key={elt.id} value={elt.id}>
              <span className="mr-2">{elt.flag}</span>
              {elt.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
