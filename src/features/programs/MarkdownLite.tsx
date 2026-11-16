import type { ReactNode } from 'react';
import { Fragment } from 'react';

/**
 * Tiny markdown renderer for program body content.
 *
 * Supports:
 *  - `## heading` → `<h3>`
 *  - `### heading` → `<h4>`
 *  - `**bold**` → `<strong>`
 *  - `*italic*` → `<em>`
 *  - `- item` (consecutive) → `<ul>`
 *  - `1. item` (consecutive) → `<ol>`
 *  - blank-line-separated paragraphs
 *
 * Not a full CommonMark parser. Anything fancier — install react-markdown.
 */
export function MarkdownLite({ source }: { source: string }) {
  const blocks = parseBlocks(source);
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {blocks.map((block, i) => renderBlock(block, i))}
    </div>
  );
}

type Block
  = | { kind: 'h3'; text: string }
    | { kind: 'h4'; text: string }
    | { kind: 'p'; text: string }
    | { kind: 'ul'; items: string[] }
    | { kind: 'ol'; items: string[] };

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (trimmed.startsWith('### ')) {
      blocks.push({ kind: 'h4', text: trimmed.slice(4) });
      i += 1;
      continue;
    }

    if (trimmed.startsWith('## ')) {
      blocks.push({ kind: 'h3', text: trimmed.slice(3) });
      i += 1;
      continue;
    }

    // unordered list
    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i]!.trim())) {
        items.push(lines[i]!.trim().replace(/^[-*]\s+/, ''));
        i += 1;
      }
      blocks.push({ kind: 'ul', items });
      continue;
    }

    // ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i]!.trim())) {
        items.push(lines[i]!.trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push({ kind: 'ol', items });
      continue;
    }

    // paragraph: gather consecutive non-empty, non-block lines
    const paragraph: string[] = [];
    while (i < lines.length) {
      const t = lines[i]!.trim();
      if (!t || t.startsWith('## ') || t.startsWith('### ') || /^[-*]\s+/.test(t) || /^\d+\.\s+/.test(t)) {
        break;
      }
      paragraph.push(t);
      i += 1;
    }
    if (paragraph.length > 0) {
      blocks.push({ kind: 'p', text: paragraph.join(' ') });
    }
  }

  return blocks;
}

function renderInline(text: string): ReactNode[] {
  // Tokenize **bold**, then *italic* in pieces.
  const out: ReactNode[] = [];
  const boldSplit = text.split(/(\*\*[^*]+\*\*)/g);
  for (let bi = 0; bi < boldSplit.length; bi += 1) {
    const chunk = boldSplit[bi]!;
    if (/^\*\*[^*]+\*\*$/.test(chunk)) {
      out.push(<strong key={`b-${bi}`}>{chunk.slice(2, -2)}</strong>);
      continue;
    }
    const italicSplit = chunk.split(/(\*[^*]+\*)/g);
    italicSplit.forEach((part, ii) => {
      if (/^\*[^*]+\*$/.test(part)) {
        out.push(<em key={`i-${bi}-${ii}`}>{part.slice(1, -1)}</em>);
      } else if (part) {
        out.push(<Fragment key={`t-${bi}-${ii}`}>{part}</Fragment>);
      }
    });
  }
  return out;
}

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.kind) {
    case 'h3':
      return (
        <h3 key={key} className="mt-4 text-base font-semibold first:mt-0">
          {renderInline(block.text)}
        </h3>
      );
    case 'h4':
      return (
        <h4 key={key} className="mt-3 text-sm font-semibold first:mt-0">
          {renderInline(block.text)}
        </h4>
      );
    case 'p':
      return <p key={key}>{renderInline(block.text)}</p>;
    case 'ul':
      return (
        <ul key={key} className="ml-5 list-disc space-y-1">
          {block.items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol key={key} className="ml-5 list-decimal space-y-1">
          {block.items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ol>
      );
  }
}
