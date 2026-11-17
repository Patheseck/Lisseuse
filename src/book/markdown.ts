import { detectLanguage } from '../core/language';
import type { Chapter, ParsedBook } from './types';
import { sanitizeHtml } from './sanitize';

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inline(s: string): string {
  const codes: string[] = [];
  let out = escapeHtml(s).replace(/`([^`]+)`/g, (_, code: string) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a?: string, b?: string) => `<strong>${a ?? b}</strong>`)
    .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)|(^|[^_\w])_(?!\s)(.+?)_(?!\w)/g, (_, p1?: string, a?: string, p2?: string, b?: string) => `${p1 ?? p2 ?? ''}<em>${a ?? b}</em>`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  return out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `<code>${codes[Number(i)]}</code>`);
}

/** Convertit un sous-ensemble courant de Markdown en HTML (titres, listes, citations, code, règles). */
export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let quote: string[] = [];
  let code: string[] | null = null;

  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote>${markdownToHtml(quote.join('\n'))}</blockquote>`);
    quote = [];
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (const line of lines) {
    if (code) {
      if (/^\s*```/.test(line)) {
        out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
        code = null;
      } else code.push(line);
      continue;
    }
    if (/^\s*```/.test(line)) {
      flushAll();
      code = [];
      continue;
    }
    const q = /^\s*>\s?(.*)$/.exec(line);
    if (q) {
      flushPara();
      flushList();
      quote.push(q[1] ?? '');
      continue;
    }
    flushQuote();
    if (/^\s*$/.test(line)) {
      flushPara();
      flushList();
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      flushAll();
      const level = h[1]!.length;
      out.push(`<h${level}>${inline(h[2] ?? '')}</h${level}>`);
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushAll();
      out.push('<hr>');
      continue;
    }
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const kind = ul ? 'ul' : 'ol';
      if (list !== kind) {
        flushList();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline((ul ?? ol)![1] ?? '')}</li>`);
      continue;
    }
    if (list) flushList();
    para.push(line.trim());
  }
  if (code) out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  flushAll();
  return out.join('\n');
}

/**
 * Texte brut (.txt) écrit avec un paragraphe par ligne, sans ligne vide entre eux : en Markdown,
 * tout le fichier deviendrait un seul paragraphe. On sépare alors les lignes. Un texte coupé
 * à largeur fixe (lignes courtes, paragraphes séparés par une ligne vide) est laissé tel quel.
 */
export function txtParagraphs(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const filled = lines.filter((l) => l.trim());
  if (filled.length < 4) return text;
  const blank = lines.length - filled.length;
  const average = filled.reduce((n, l) => n + l.trim().length, 0) / filled.length;
  return blank < filled.length * 0.1 && average > 80 ? lines.join('\n\n') : text;
}

/** Découpe un document Markdown en chapitres sur les titres de niveau 1. */
export function parseMarkdown(raw: string, fileName: string): ParsedBook {
  const text = /\.txt$/i.test(fileName) ? txtParagraphs(raw) : raw;
  const parts = text.replace(/\r\n?/g, '\n').split(/\n(?=#\s)/).filter((p) => p.trim());
  const chapters: Chapter[] = parts.map((part, i) => {
    const m = /^#\s+(.+)$/m.exec(part);
    return { label: m?.[1]?.trim() || `Section ${i + 1}`, html: sanitizeHtml(markdownToHtml(part)) };
  });
  if (!chapters.length) chapters.push({ label: 'Document', html: '' });
  return {
    format: 'md',
    title: fileName.replace(/\.(md|markdown|txt)$/i, '') || 'Document',
    author: null,
    chapters,
    resources: {},
    cover: null,
    language: detectLanguage(text),
  };
}
