// next/script: scripts load after hydration, outside the React tree.
import { useEffect } from 'react';

type ScriptProps = { src?: string; strategy?: string; id?: string; children?: string; dangerouslySetInnerHTML?: { __html: string } } & Record<string, unknown>;

const loaded = new Set<string>();

export default function Script({ src, strategy: _strategy, children, dangerouslySetInnerHTML, ...attrs }: ScriptProps) {
  useEffect(() => {
    const key = src ?? String(attrs.id ?? children ?? dangerouslySetInnerHTML?.__html);
    if (loaded.has(key)) {
      return;
    }
    loaded.add(key);
    const el = document.createElement('script');
    for (const [k, v] of Object.entries(attrs)) {
      if (typeof v === 'string') {
        el.setAttribute(k, v);
      }
    }
    if (src) {
      el.src = src;
    } else {
      el.textContent = children ?? dangerouslySetInnerHTML?.__html ?? '';
    }
    document.body.appendChild(el);
  }, []); // eslint-disable-line react/exhaustive-deps
  return null;
}
