'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

type AuditMode = 'highlight' | 'warn' | 'throw';

export type MobileFirstAuditProps = {
  enabled?: boolean;
  mode?: AuditMode;
  viewportWidth?: number;
  ignoreSelectors?: string[];
  children: React.ReactNode;
};

type Offender = {
  id: string;
  el: Element;
  tag: string;
  className: string;
  text: string;
  domPath: string;
  rect: { left: number; right: number; top: number; bottom: number; width: number; height: number };
  scrollWidth: number;
  clientWidth: number;
};

const EPS = 1; // px; allow minor subpixel rounding

function clampText(s: string, max = 80) {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) {
    return t;
  }
  return `${t.slice(0, max - 1)}…`;
}

function safeNumber(v: number) {
  // JSON-friendly, stable enough for diffs
  return Math.round(v * 100) / 100;
}

function getDomPath(el: Element, maxDepth = 8) {
  const parts: string[] = [];
  let cur: Element | null = el;
  let depth = 0;
  while (cur && depth < maxDepth) {
    const tag = cur.tagName.toLowerCase();
    if (tag === 'html') {
      parts.push('html');
      break;
    }
    if (tag === 'body') {
      parts.push('body');
      break;
    }

    let seg = tag;
    const id = (cur as HTMLElement).id;
    if (id) {
      seg += `#${CSS.escape(id)}`;
      parts.push(seg);
      break; // id is usually unique enough
    }

    const classList = (cur as HTMLElement).classList;
    if (classList && classList.length) {
      const cls = Array.from(classList).slice(0, 3).map(c => `.${CSS.escape(c)}`).join('');
      seg += cls;
    }

    const parentEl: HTMLElement | null = cur.parentElement;
    if (parentEl) {
      const curTagName = cur.tagName;
      const siblings = Array.from(parentEl.children).filter(c => c.tagName === curTagName);
      if (siblings.length > 1) {
        const idx = siblings.indexOf(cur) + 1;
        seg += `:nth-of-type(${idx})`;
      }
    }

    parts.push(seg);
    cur = parentEl;
    depth += 1;
  }

  return parts.reverse().join(' > ');
}

function elementId(el: Element) {
  const p = getDomPath(el, 6);
  return `${el.tagName.toLowerCase()}|${p}`;
}

function matchesIgnore(el: Element, ignoreSelectors: string[]) {
  for (const sel of ignoreSelectors) {
    try {
      if (el.matches(sel) || (el instanceof HTMLElement && el.closest(sel))) {
        return true;
      }
    } catch {
      // ignore invalid selectors
    }
  }
  return false;
}

export function MobileFirstAudit(props: MobileFirstAuditProps) {
  const enabled = props.enabled ?? false;
  const mode: AuditMode = props.mode ?? 'highlight';

  const ignoreSelectors = useMemo(() => {
    return [
      // Always ignore audit UI itself
      '[data-mobile-audit-ui="true"]',
      ...(props.ignoreSelectors ?? []),
    ];
  }, [props.ignoreSelectors]);

  const isProd = process.env.NODE_ENV === 'production';
  const active = enabled && !isProd;

  const [offenders, setOffenders] = useState<Offender[]>([]);
  const [docOverflowPx, setDocOverflowPx] = useState(0);
  const pinnedRef = useRef<Set<string>>(new Set());
  const lastReportRef = useRef<any>(null);
  const thrownRef = useRef(false);

  const rafRef = useRef<number | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const moRef = useRef<MutationObserver | null>(null);

  const lastMarkedRef = useRef<Set<Element>>(new Set());

  function clearMarks(nextPinned?: Set<string>) {
    for (const el of lastMarkedRef.current) {
      (el as HTMLElement).removeAttribute('data-mobile-overflow');
      (el as HTMLElement).classList.remove('mobile-overflow-outline');
      (el as HTMLElement).classList.remove('mobile-overflow-pinned');
    }
    lastMarkedRef.current = new Set();

    if (nextPinned) {
      pinnedRef.current = nextPinned;
    }
  }

  function scheduleScan() {
    if (!active) {
      return;
    }
    if (rafRef.current != null) {
      return;
    }
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      scanNow();
    });
  }

  function scanNow() {
    if (!active) {
      return;
    }

    const w = window.innerWidth;
    const docEl = document.documentElement;

    const docScroll = Math.max(docEl.scrollWidth, document.body?.scrollWidth ?? 0);
    const overflowPx = Math.max(0, docScroll - w);
    setDocOverflowPx(overflowPx);

    const found: Offender[] = [];

    const all = Array.from(document.body?.querySelectorAll('*') ?? []);
    for (const el of all) {
      if (!(el instanceof HTMLElement)) {
        continue;
      }
      if (matchesIgnore(el, ignoreSelectors)) {
        continue;
      }

      const rect = el.getBoundingClientRect();
      if ((rect.width <= 0 && rect.height <= 0) || Number.isNaN(rect.width)) {
        continue;
      }

      const exceedsRight = rect.right > w + EPS;
      const exceedsLeft = rect.left < -EPS;

      // Secondary heuristic: when there IS document overflow, try to spot likely contributors even if their
      // border-box is inside the viewport (e.g. overflow-visible children).
      const style = window.getComputedStyle(el);
      const overflowVisible = style.overflowX === 'visible';
      const scrollOverflow = el.scrollWidth > el.clientWidth + EPS;
      const maybePaintOverflow = overflowPx > EPS && overflowVisible && scrollOverflow;

      if (!exceedsRight && !exceedsLeft && !maybePaintOverflow) {
        continue;
      }

      const cls = el.className && typeof el.className === 'string' ? el.className : '';
      const text = clampText(el.textContent || '');

      found.push({
        id: elementId(el),
        el,
        tag: el.tagName.toLowerCase(),
        className: clampText(cls, 60),
        text,
        domPath: getDomPath(el),
        rect: {
          left: safeNumber(rect.left),
          right: safeNumber(rect.right),
          top: safeNumber(rect.top),
          bottom: safeNumber(rect.bottom),
          width: safeNumber(rect.width),
          height: safeNumber(rect.height),
        },
        scrollWidth: safeNumber(el.scrollWidth),
        clientWidth: safeNumber(el.clientWidth),
      });
    }

    // Sort worst offenders first by max overhang
    found.sort((a, b) => {
      const aOver = Math.max(0, a.rect.right - w, 0 - a.rect.left);
      const bOver = Math.max(0, b.rect.right - w, 0 - b.rect.left);
      return bOver - aOver;
    });

    // Apply marks
    clearMarks();
    const marked = new Set<Element>();
    for (const o of found) {
      const el = o.el as HTMLElement;
      el.setAttribute('data-mobile-overflow', 'true');
      el.classList.add('mobile-overflow-outline');
      if (pinnedRef.current.has(o.id)) {
        el.classList.add('mobile-overflow-pinned');
      }
      marked.add(o.el);
    }
    lastMarkedRef.current = marked;

    setOffenders(found);

    const report = {
      ts: new Date().toISOString(),
      viewport: { width: w, height: window.innerHeight },
      document: {
        scrollWidth: docScroll,
        overflowPx,
      },
      offenders: found.map(o => ({
        id: o.id,
        domPath: o.domPath,
        tag: o.tag,
        className: o.className,
        text: o.text,
        rect: o.rect,
        scrollWidth: o.scrollWidth,
        clientWidth: o.clientWidth,
      })),
    };
    lastReportRef.current = report;

    if (overflowPx > EPS) {
      if (mode === 'warn') {
        console.warn('[MobileFirstAudit] Horizontal overflow detected', report);
      } else if (mode === 'throw' && !thrownRef.current) {
        thrownRef.current = true;
        // Throw on next tick so React commit finishes cleanly.
        setTimeout(() => {
          throw new Error(
            `[MobileFirstAudit] Horizontal overflow detected (overflowPx=${overflowPx}). Report: ${JSON.stringify(
              report,
            )}`,
          );
        }, 0);
      }
    } else {
      thrownRef.current = false;
    }
  }

  useEffect(() => {
    if (!active) {
      clearMarks(new Set());
      setOffenders([]);
      setDocOverflowPx(0);
      return;
    }

    scheduleScan();

    const ro = new ResizeObserver(() => scheduleScan());
    ro.observe(document.documentElement);
    ro.observe(document.body);
    roRef.current = ro;

    const mo = new MutationObserver(() => scheduleScan());
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    moRef.current = mo;

    window.addEventListener('resize', scheduleScan, { passive: true });

    return () => {
      window.removeEventListener('resize', scheduleScan);
      roRef.current?.disconnect();
      moRef.current?.disconnect();
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      clearMarks(new Set());
    };
    // eslint-disable-next-line react/exhaustive-deps
  }, [active, mode, ignoreSelectors.join('|')]);

  useEffect(() => {
    if (!active) {
      return;
    }
    if (!props.viewportWidth) {
      return;
    }
    const prevHtml = document.documentElement.style.overflowX;
    const prevBody = document.body.style.overflowX;
    document.documentElement.style.overflowX = 'hidden';
    document.body.style.overflowX = 'hidden';
    return () => {
      document.documentElement.style.overflowX = prevHtml;
      document.body.style.overflowX = prevBody;
    };
  }, [active, props.viewportWidth]);

  const showOverlay = active; // overlay is dev-only, but still useful in warn/throw

  const harnessWidth = active && props.viewportWidth ? Math.max(240, props.viewportWidth) : null;

  return (
    <>
      {active && (

        <style
          dangerouslySetInnerHTML={{
            __html: `
              .mobile-overflow-outline{ outline:2px solid rgba(239,68,68,.95)!important; outline-offset:2px!important; }
              .mobile-overflow-pinned{ outline:3px solid rgba(245,158,11,.95)!important; outline-offset:3px!important; }
            `,
          }}
        />
      )}

      {showOverlay && (
        <div
          data-mobile-audit-ui="true"
          className="fixed right-2 top-2 z-[9999] w-[min(92vw,360px)] rounded-md border bg-background/95 p-2 text-xs shadow-lg backdrop-blur"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-semibold">
                Overflow:
                {' '}
                {offenders.length}
                {' '}
                {docOverflowPx > EPS ? `(doc +${Math.round(docOverflowPx)}px)` : '(doc OK)'}
              </div>
              <div className="text-[11px] text-muted-foreground">Click an item to scroll + pin. Copy report for debugging.</div>
            </div>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                className="rounded border px-2 py-1 hover:bg-muted"
                onClick={() => {
                  pinnedRef.current = new Set();
                  scheduleScan();
                }}
              >
                Clear pins
              </button>
              <button
                type="button"
                className="rounded border px-2 py-1 hover:bg-muted"
                onClick={async () => {
                  const report = lastReportRef.current ?? { offenders: [] };
                  await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
                }}
              >
                Copy report
              </button>
            </div>
          </div>

          {offenders.length > 0 && (
            <div className="mt-2 max-h-[40dvh] overflow-auto">
              <div className="space-y-1">
                {offenders.slice(0, 6).map(o => (
                  <button
                    key={o.id}
                    type="button"
                    className="w-full rounded border px-2 py-1 text-left hover:bg-muted"
                    onClick={() => {
                      pinnedRef.current.add(o.id);
                      (o.el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
                      scheduleScan();
                    }}
                    title={o.domPath}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="font-medium">{o.tag}</span>
                        {o.className
                          ? (
                              <span className="text-muted-foreground">
                                {' '}
                                .
                                {o.className.replace(/\s+/g, '.')}
                              </span>
                            )
                          : null}
                      </div>
                      <div className="shrink-0 text-[11px] text-muted-foreground">
                        {Math.round(o.rect.right)}
                        px
                      </div>
                    </div>
                    {o.text ? <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{o.text}</div> : null}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {harnessWidth
        ? (
            <div data-mobile-audit-ui="true" className="flex h-dvh w-full justify-center bg-background">
              <div
                className="h-dvh w-[min(100vw,var(--mobile-harness-width))] max-w-[100vw] overflow-y-auto"
                style={{ ['--mobile-harness-width' as any]: `${harnessWidth}px` }}
              >
                {props.children}
              </div>
            </div>
          )
        : (
            props.children
          )}
    </>
  );
}
