import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Liste des logiciels libres livrés dans l'application, avec le texte de leurs licences.
// Elle est produite à chaque construction (voir vite.config.ts) à partir des dépendances de
// production, et affichée dans « À propos ». Les licences MIT, Apache et OFL demandent que
// leurs mentions accompagnent le logiciel distribué.

interface PackageInfo {
  name: string;
  version: string;
  license: string;
  text: string;
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

/** Dossier d'un paquet, cherché comme le fait Node (node_modules imbriqués puis parents). */
function findPackage(name: string, fromDir: string): string | null {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function licenseId(pkg: Record<string, unknown>): string {
  const license = pkg.license as string | { type?: string } | undefined;
  if (typeof license === 'string') return license;
  if (license?.type) return license.type;
  const licenses = pkg.licenses as { type?: string }[] | undefined;
  return licenses?.map((l) => l.type).filter(Boolean).join(' OR ') || 'inconnue';
}

function licenseText(dir: string): string {
  const files = readdirSync(dir).filter((f) => /^(licen[sc]e|copying|notice)([.-].*)?$/i.test(f)).sort();
  return files.map((f) => readFileSync(join(dir, f), 'utf8').trim()).join('\n\n');
}

/** Texte MIT standard, pour un paquet MIT qui ne fournit pas de fichier de licence. */
function mitText(author: string): string {
  return `Copyright (c) ${author}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;
}

function authorOf(pkg: Record<string, unknown>): string {
  const author = pkg.author as string | { name?: string } | undefined;
  return (typeof author === 'string' ? author : author?.name) || `les auteurs de ${String(pkg.name)}`;
}

/** Dépendances de production, récursivement, dédoublonnées par nom et version. */
function productionPackages(root: string): PackageInfo[] {
  const seen = new Map<string, PackageInfo>();
  const queue: { name: string; from: string }[] = Object.keys((readJson(join(root, 'package.json')).dependencies as Record<string, string>) ?? {}).map((name) => ({ name, from: root }));
  while (queue.length) {
    const { name, from } = queue.shift()!;
    const dir = findPackage(name, from);
    if (!dir) continue;
    const pkg = readJson(join(dir, 'package.json'));
    const key = `${name}@${String(pkg.version)}`;
    if (seen.has(key)) continue;
    const license = licenseId(pkg);
    const text = licenseText(dir) || (license === 'MIT' ? mitText(authorOf(pkg)) : '');
    seen.set(key, { name, version: String(pkg.version), license, text });
    for (const dep of Object.keys((pkg.dependencies as Record<string, string>) ?? {})) queue.push({ name: dep, from: dir });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Composants Android natifs inclus dans l'APK (tous sous licence Apache 2.0). */
const NATIVE = [
  'AndroidX (Jetpack) — © The Android Open Source Project',
  'Kotlin (bibliothèque standard) et kotlinx.coroutines — © JetBrains s.r.o. et contributeurs',
  'Apache Cordova (couche de compatibilité de Capacitor) — © The Apache Software Foundation',
  'Guava ListenableFuture — © The Guava Authors',
];

function apacheText(root: string): string {
  // Le texte complet de la licence Apache 2.0 est fourni par DOMPurify (double licence).
  const dir = findPackage('dompurify', root);
  const text = dir ? licenseText(dir) : '';
  const start = text.indexOf('Apache License');
  const end = text.indexOf('END OF TERMS AND CONDITIONS');
  return start >= 0 && end > start ? text.slice(start, end + 'END OF TERMS AND CONDITIONS'.length) : 'Apache License 2.0 : https://www.apache.org/licenses/LICENSE-2.0';
}

export function collectLicenses(root: string): string {
  const app = readJson(join(root, 'package.json'));
  const packages = productionPackages(root);
  const line = '='.repeat(60);
  return [
    `Liseuse ${String(app.version)} — logiciels libres utilisés`,
    line,
    '',
    'Liseuse est construite avec les logiciels libres suivants. Merci à leurs auteurs.',
    '',
    'Bibliothèques de l’application (JavaScript et polices de caractères)',
    ...packages.map((p) => `- ${p.name} ${p.version} — ${p.license}`),
    '',
    'Bibliothèques Android (code natif), sous licence Apache 2.0',
    ...NATIVE.map((n) => `- ${n}`),
    '',
    line,
    'Textes des licences',
    line,
    ...packages.flatMap((p) => ['', `--- ${p.name} ${p.version} (${p.license}) ---`, '', p.text || `Licence ${p.license} (texte non fourni par le paquet).`]),
    '',
    '--- Bibliothèques Android : Apache License 2.0 ---',
    '',
    apacheText(root),
    '',
  ].join('\n');
}
