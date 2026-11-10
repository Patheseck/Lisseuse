import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';
import { collectLicenses } from './scripts/licenses.ts';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * Ressources de pdf.js servies avec l'app sous pdfjs/ (rien n'est téléchargé : l'app reste hors
 * ligne). Ce sont celles de la visionneuse de pdf.js, dont Android a besoin.
 */
const PDFJS_DIR = join(process.cwd(), 'node_modules', 'pdfjs-dist');
const PDFJS_RESOURCES = new Map<string, RegExp>([
  // Tables de caractères d'Adobe (CMaps), pour certains PDF (polices CJK notamment).
  ['cmaps', /^[\w.-]+\.bcmap$/],
  // Polices standard (Times, Helvetica, Courier…) des PDF qui ne les intègrent pas : Android n'en
  // a pas d'équivalent, et ses polices système dessinent mal ces textes.
  ['standard_fonts', /^[\w-]+\.(pfb|ttf)$/],
  // Décodeurs des images JPEG 2000 et JBIG2 (livres numérisés), et leur version sans WebAssembly.
  ['wasm', /^(openjpeg|jbig2)(\.wasm|_nowasm_fallback\.js)$/],
]);
const MIME: Record<string, string> = { js: 'text/javascript', wasm: 'application/wasm', ttf: 'font/ttf' };

/**
 * pdf.js donne leur taille aux pages (et à leurs couches) avec la fonction CSS round(), que les
 * WebView antérieures à Chrome 125 ne connaissent pas (Android 7 en reste à Chrome 119) : les pages
 * y auraient une hauteur nulle, invisibles, et l'écran resterait blanc. Là où round() manque, la
 * taille est calculée sans arrondi, comme avant pdf.js 5.
 */
const PDFJS_ROUND = /const widthStr = `round\(down, var\(--total-scale-factor\) \* \$\{pageWidth\}px, var\(--scale-round-x\)\)`,\s*heightStr = `round\(down, var\(--total-scale-factor\) \* \$\{pageHeight\}px, var\(--scale-round-y\)\)`;/;
const PDFJS_ROUND_FALLBACK = [
  'const cssRound = globalThis.CSS?.supports?.("width", "round(down, 1.5px, 1px)") !== false;',
  'const widthStr = cssRound ? `round(down, var(--total-scale-factor) * ${pageWidth}px, var(--scale-round-x))` : `calc(var(--total-scale-factor) * ${pageWidth}px)`,',
  '  heightStr = cssRound ? `round(down, var(--total-scale-factor) * ${pageHeight}px, var(--scale-round-y))` : `calc(var(--total-scale-factor) * ${pageHeight}px)`;',
].join('\n');

export default defineConfig({
  // Chemins relatifs : l'app est servie depuis le système de fichiers de la WebView Capacitor.
  base: './',
  build: { outDir: 'dist', target: 'es2022', sourcemap: false },
  // Version affichée dans « À propos » (la même que celle de l'APK, voir android/app/build.gradle).
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    {
      // licenses.txt : logiciels libres livrés dans l'app et textes de leurs licences.
      name: 'liseuse-licences',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'licenses.txt', source: collectLicenses(process.cwd()) });
      },
      configureServer(server) {
        server.middlewares.use('/licenses.txt', (_req, res) => {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(collectLicenses(process.cwd()));
        });
      },
    },
    {
      name: 'liseuse-pdfjs-css-round',
      transform(code, id) {
        if (!/[\\/]pdfjs-dist[\\/]legacy[\\/]build[\\/]pdf\.mjs$/.test(id.split('?')[0] ?? '')) return null;
        // pdf.js a changé : le correctif est à revoir (sinon pages blanches sur les vieux Android).
        if (!PDFJS_ROUND.test(code)) this.error('pdf.js : la taille des pages (setLayerDimensions) a changé, revoir PDFJS_ROUND dans vite.config.ts.');
        return { code: code.replace(PDFJS_ROUND, PDFJS_ROUND_FALLBACK), map: null };
      },
    },
    {
      name: 'liseuse-pdfjs-resources',
      generateBundle() {
        for (const [dir, pattern] of PDFJS_RESOURCES) {
          for (const name of readdirSync(join(PDFJS_DIR, dir))) {
            if (pattern.test(name)) this.emitFile({ type: 'asset', fileName: `pdfjs/${dir}/${name}`, source: readFileSync(join(PDFJS_DIR, dir, name)) });
          }
        }
      },
      configureServer(server) {
        server.middlewares.use('/pdfjs/', (req, res, next) => {
          const [dir = '', name = ''] = (req.url ?? '').replace(/^\/+/, '').split('?')[0]!.split('/');
          const pattern = PDFJS_RESOURCES.get(dir);
          if (!pattern?.test(name)) return next();
          res.setHeader('Content-Type', MIME[name.split('.').pop()!] ?? 'application/octet-stream');
          res.end(readFileSync(join(PDFJS_DIR, dir, name)));
        });
      },
    },
  ],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'jsdom',
    setupFiles: ['tests/unit/setup.ts'],
  },
});
