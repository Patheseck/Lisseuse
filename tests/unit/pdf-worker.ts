// pdf.js sans worker dans les tests unitaires : son module de travail est chargé directement
// (pdf.js le détecte et travaille dans le même fil, ce que les navigateurs ne font pas).
const g = globalThis as { pdfjsWorker?: unknown };
// @ts-expect-error -- module sans déclaration de types, chargé seulement pour être détecté par pdf.js
g.pdfjsWorker ??= await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
export {};
