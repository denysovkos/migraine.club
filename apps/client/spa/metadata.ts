// What Next wrote into <html>, <body> and <head> per route, applied on
// client-side navigation (the Go server writes the same for the first load).
export type Metadata = {
  title?: string | { default?: string; template?: string; absolute?: string } | null;
  description?: string | null;
  [k: string]: unknown;
};

type DocumentState = { lang: string | null; htmlClass: string | null; bodyClass: string | null; title?: string };

function setAttr(el: Element, name: string, value: string | null) {
  if (value === null) {
    el.removeAttribute(name);
  } else {
    el.setAttribute(name, value);
  }
}

export function setDocument(s: DocumentState) {
  setAttr(document.documentElement, 'lang', s.lang);
  setAttr(document.documentElement, 'class', s.htmlClass);
  setAttr(document.body, 'class', s.bodyClass);
  if (s.title !== undefined) {
    document.title = s.title;
  }
}

function setMeta(name: string, content: string | null | undefined) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (content === undefined || content === null) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('meta');
    el.name = name;
    document.head.appendChild(el);
  }
  el.content = content;
}

/** Next's title resolution: the deepest title wins; a layout's template wraps the titles below it. */
export function applyMetadata(chain: (Metadata | undefined)[]) {
  let title: string | undefined;
  let template: string | undefined;
  let description: string | null | undefined;
  for (const m of chain) {
    if (!m) {
      continue;
    }
    const t = m.title;
    if (typeof t === 'string') {
      title = template ? template.replace('%s', t) : t;
    } else if (t && typeof t === 'object') {
      title = t.absolute ?? (t.default !== undefined ? t.default : title);
      template = t.template ?? template;
    }
    if (m.description !== undefined) {
      description = m.description;
    }
  }
  if (title !== undefined) {
    document.title = title;
  }
  setMeta('description', description);
}
