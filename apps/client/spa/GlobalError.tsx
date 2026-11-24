import { useEffect, useLayoutEffect } from 'react';
import { setDocument } from './metadata';

// src/app/global-error.tsx: an error no page handled is reported to Sentry
// and Next's client-side exception page (next/error, status 0) is shown in
// a bare document.
import { reportError } from './reportError';

const styles = {
  error: { fontFamily: 'system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji"', height: '100vh', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
  desc: { lineHeight: '48px' },
  h2: { fontSize: 14, fontWeight: 400, lineHeight: '28px' },
  wrap: { display: 'inline-block' },
} as const;

export function GlobalError({ error, locale }: { error: unknown; locale?: string }) {
  useLayoutEffect(() => {
    setDocument({ lang: locale ?? null, htmlClass: null, bodyClass: null, title: '' });
  }, [locale]);
  useEffect(() => {
    void reportError(error);
  }, [error]);
  return (
    <div style={styles.error}>
      <div style={styles.desc}>
        <style dangerouslySetInnerHTML={{ __html: 'body{color:#000;background:#fff;margin:0}.next-error-h1{border-right:1px solid rgba(0,0,0,.3)}@media (prefers-color-scheme:dark){body{color:#fff;background:#000}.next-error-h1{border-right:1px solid rgba(255,255,255,.3)}}' }} />
        <div style={styles.wrap}>
          <h2 style={styles.h2}>
            Application error: a client-side exception has occurred
            {' '}
            {' '}
            (see the browser console for more information).
          </h2>
        </div>
      </div>
    </div>
  );
}
