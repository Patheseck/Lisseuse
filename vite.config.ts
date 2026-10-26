import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Chemins relatifs : l'app est servie depuis le système de fichiers de la WebView Capacitor.
  base: './',
  build: { outDir: 'dist', target: 'es2022', sourcemap: false },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'jsdom',
    setupFiles: ['tests/unit/setup.ts'],
  },
});
