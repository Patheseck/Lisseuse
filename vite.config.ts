import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';
import { collectLicenses } from './scripts/licenses.ts';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/** Tables de caractères d'Adobe (CMaps), dont pdf.js a besoin pour certains PDF (polices CJK notamment). */
const CMAPS_DIR = join(process.cwd(), 'node_modules', 'pdfjs-dist', 'cmaps');

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
      // pdfjs/cmaps/ : servies avec l'app (rien n'est téléchargé, l'app reste hors ligne).
      name: 'liseuse-pdf-cmaps',
      generateBundle() {
        for (const name of readdirSync(CMAPS_DIR)) {
          if (name.endsWith('.bcmap')) this.emitFile({ type: 'asset', fileName: `pdfjs/cmaps/${name}`, source: readFileSync(join(CMAPS_DIR, name)) });
        }
      },
      configureServer(server) {
        server.middlewares.use('/pdfjs/cmaps/', (req, res, next) => {
          const name = (req.url ?? '').replace(/^\/+/, '').split('?')[0] ?? '';
          if (!/^[\w.-]+\.bcmap$/.test(name)) return next();
          res.setHeader('Content-Type', 'application/octet-stream');
          res.end(readFileSync(join(CMAPS_DIR, name)));
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
