import JSZip from 'jszip';
import type { Chapter, ParsedBook } from './types';
import { sanitizeHtml } from './sanitize';

export class EpubError extends Error {}

/** Résout `relative` par rapport au fichier `basePath` (chemins internes à l'archive). */
export function resolvePath(basePath: string, relative: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(relative)) return relative;
  const dir = basePath.includes('/') ? basePath.slice(0, basePath.lastIndexOf('/') + 1) : '';
  const stack: string[] = [];
  for (const part of (dir + relative).split('/')) {
    if (part === '..') stack.pop();
    else if (part !== '.' && part !== '') stack.push(part);
  }
  return stack.join('/');
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function splitHref(href: string): [string, string] {
  const i = href.indexOf('#');
  return i === -1 ? [href, ''] : [href.slice(0, i), href.slice(i + 1)];
}

/** Éléments par nom local, quel que soit le préfixe d'espace de noms (dc:title, opf:item…). */
function byLocalName(root: ParentNode, name: string): Element[] {
  const all = root instanceof Document ? root.getElementsByTagName('*') : (root as Element).getElementsByTagName('*');
  return Array.from(all).filter((el) => el.localName === name);
}

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new EpubError('XML invalide');
  return doc;
}

function parseXhtml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xhtml+xml');
  if (!doc.getElementsByTagName('parsererror').length && doc.body) return doc;
  // Beaucoup d'EPUB contiennent du XHTML mal formé : on se rabat sur le parseur HTML tolérant.
  return new DOMParser().parseFromString(text, 'text/html');
}

class Archive {
  private readonly lower = new Map<string, JSZip.JSZipObject>();
  constructor(private readonly zip: JSZip) {
    zip.forEach((path, file) => this.lower.set(path.toLowerCase(), file));
  }
  find(path: string): JSZip.JSZipObject | null {
    const decoded = safeDecode(path);
    return this.zip.file(path) ?? this.zip.file(decoded) ?? this.lower.get(decoded.toLowerCase()) ?? null;
  }
  async text(path: string): Promise<string | null> {
    return (await this.find(path)?.async('string')) ?? null;
  }
  async blob(path: string, type: string): Promise<Blob | null> {
    const file = this.find(path);
    if (!file) return null;
    return new Blob([await file.async('arraybuffer')], { type });
  }
  firstMatching(re: RegExp): string | null {
    for (const [path] of this.lower) if (re.test(path)) return path;
    return null;
  }
}

interface ManifestItem {
  href: string;
  mediaType: string;
  properties: string;
}

const IMAGE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', avif: 'image/avif',
};
function guessImageType(path: string): string {
  return IMAGE_TYPES[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

export async function parseEpub(data: Blob | ArrayBuffer | Uint8Array, fileName: string): Promise<ParsedBook> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data instanceof Blob ? await data.arrayBuffer() : data);
  } catch {
    throw new EpubError('Ce fichier n’est pas une archive EPUB valide.');
  }
  const archive = new Archive(zip);

  // 1. Localiser le fichier OPF.
  let opfPath: string | null = null;
  const container = await archive.text('META-INF/container.xml');
  if (container) {
    const rootfile = byLocalName(parseXml(container), 'rootfile')[0];
    opfPath = rootfile?.getAttribute('full-path') ?? null;
  }
  opfPath ??= archive.firstMatching(/\.opf$/);
  const opfText = opfPath ? await archive.text(opfPath) : null;
  if (!opfPath || !opfText) throw new EpubError('Paquet EPUB introuvable (fichier OPF manquant).');
  const opf = parseXml(opfText);

  // 2. Manifeste, ordre de lecture, métadonnées.
  const manifest = new Map<string, ManifestItem>();
  for (const item of byLocalName(opf, 'item')) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (!id || !href) continue;
    manifest.set(id, {
      href: resolvePath(opfPath, safeDecode(href)),
      mediaType: item.getAttribute('media-type') ?? '',
      properties: item.getAttribute('properties') ?? '',
    });
  }
  const spine = byLocalName(opf, 'itemref')
    .map((ref) => manifest.get(ref.getAttribute('idref') ?? ''))
    .filter((item): item is ManifestItem => !!item && /x?html/.test(item.mediaType || 'html'));
  if (!spine.length) throw new EpubError('Ce livre ne contient aucun chapitre lisible.');

  const metaText = (name: string) => byLocalName(opf, name)[0]?.textContent?.trim() || null;
  const title = metaText('title') || fileName.replace(/\.epub$/i, '') || 'Sans titre';
  const author = metaText('creator');

  // 3. Couverture.
  const coverId = byLocalName(opf, 'meta').find((m) => m.getAttribute('name') === 'cover')?.getAttribute('content');
  const coverItem =
    (coverId ? manifest.get(coverId) : undefined) ??
    [...manifest.values()].find((m) => /(^|\s)cover-image(\s|$)/.test(m.properties)) ??
    [...manifest.entries()].find(([id, m]) => /cover/i.test(id) && m.mediaType.startsWith('image/'))?.[1];
  const cover = coverItem ? await archive.blob(coverItem.href, coverItem.mediaType || guessImageType(coverItem.href)) : null;

  // 4. Table des matières : nav.xhtml (EPUB 3) sinon toc.ncx (EPUB 2).
  const tocLabels = new Map<string, string>();
  const navItem = [...manifest.values()].find((m) => /(^|\s)nav(\s|$)/.test(m.properties));
  const navText = navItem ? await archive.text(navItem.href) : null;
  if (navItem && navText) {
    const navDoc = parseXhtml(navText);
    const navs = byLocalName(navDoc, 'nav');
    const toc = navs.find((n) => /toc/.test(n.getAttribute('epub:type') ?? n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ?? '')) ?? navs[0];
    for (const a of toc ? byLocalName(toc, 'a') : []) {
      const href = a.getAttribute('href');
      const label = a.textContent?.replace(/\s+/g, ' ').trim();
      if (!href || !label) continue;
      const target = resolvePath(navItem.href, safeDecode(splitHref(href)[0]));
      if (!tocLabels.has(target)) tocLabels.set(target, label);
    }
  } else {
    const ncxId = byLocalName(opf, 'spine')[0]?.getAttribute('toc');
    const ncxItem = (ncxId ? manifest.get(ncxId) : undefined) ?? [...manifest.values()].find((m) => m.mediaType === 'application/x-dtbncx+xml');
    const ncxText = ncxItem ? await archive.text(ncxItem.href) : null;
    if (ncxItem && ncxText) {
      for (const point of byLocalName(parseXml(ncxText), 'navPoint')) {
        const label = byLocalName(point, 'text')[0]?.textContent?.replace(/\s+/g, ' ').trim();
        const src = byLocalName(point, 'content')[0]?.getAttribute('src');
        if (!label || !src) continue;
        const target = resolvePath(ncxItem.href, safeDecode(splitHref(src)[0]));
        if (!tocLabels.has(target)) tocLabels.set(target, label);
      }
    }
  }

  // 5. Chapitres : images extraites comme ressources, liens internes convertis.
  const spineIndex = new Map(spine.map((item, i) => [item.href, i]));
  const resources: Record<string, Blob> = {};
  const chapters: Chapter[] = [];
  let untitled = 0;

  for (const item of spine) {
    const raw = await archive.text(item.href);
    const doc = raw ? parseXhtml(raw) : null;
    const body = doc?.body;
    if (!doc || !body) continue;

    // <svg><image href> (couvertures surtout) → <img>, plus simple à afficher et à nettoyer.
    for (const svg of byLocalName(body, 'svg')) {
      const image = byLocalName(svg, 'image')[0];
      const href = image?.getAttribute('href') ?? image?.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      if (!href) continue;
      const img = doc.createElement('img');
      img.setAttribute('src', href);
      img.setAttribute('alt', '');
      svg.replaceWith(img);
    }
    for (const img of byLocalName(body, 'img')) {
      const src = img.getAttribute('src');
      img.removeAttribute('src');
      if (!src || /^[a-z]+:/i.test(src)) continue;
      const path = resolvePath(item.href, safeDecode(src));
      if (!(path in resources)) {
        const blob = await archive.blob(path, guessImageType(path));
        if (!blob) continue;
        resources[path] = blob;
      }
      img.setAttribute('data-res', path);
      if (!img.hasAttribute('alt')) img.setAttribute('alt', '');
    }
    for (const a of byLocalName(body, 'a')) {
      const href = a.getAttribute('href');
      if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
      const [file, anchor] = splitHref(safeDecode(href));
      const target = file ? spineIndex.get(resolvePath(item.href, file)) : spineIndex.get(item.href);
      a.removeAttribute('href');
      if (target !== undefined) a.setAttribute('data-chapter', String(target));
      if (anchor) a.setAttribute('data-anchor', anchor);
    }
    // Les id du livre ne doivent pas entrer en collision avec ceux de l'app.
    for (const el of Array.from(body.querySelectorAll('[id]'))) {
      el.setAttribute('data-anchor-id', el.getAttribute('id') ?? '');
      el.removeAttribute('id');
    }

    const heading = byLocalName(body, 'h1')[0] ?? byLocalName(body, 'h2')[0];
    const label = tocLabels.get(item.href) ?? heading?.textContent?.replace(/\s+/g, ' ').trim() ?? `Section ${++untitled}`;
    chapters.push({ label, html: sanitizeHtml(body.innerHTML) });
  }
  if (!chapters.length) throw new EpubError('Ce livre ne contient aucun chapitre lisible.');

  return { format: 'epub', title, author, chapters, resources, cover };
}
