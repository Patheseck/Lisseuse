import type { Page } from '@playwright/test';

/** Collecte les erreurs JavaScript et console : un test échoue s'il y en a. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

export async function importFile(page: Page, name: string, mimeType: string, buffer: Buffer): Promise<void> {
  await page.getByTestId('file-input').setInputFiles({ name, mimeType, buffer });
}

/** Sélectionne dans le chapitre affiché le texte allant de `from` à la fin de `to`. */
export async function selectText(page: Page, from: string, to: string): Promise<void> {
  await page.getByTestId('reader-content').evaluate(
    (root, [a, b]) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let start: [Node, number] | null = null;
      let end: [Node, number] | null = null;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = n.textContent ?? '';
        if (!start && t.includes(a!)) start = [n, t.indexOf(a!)];
        if (start && t.includes(b!)) {
          end = [n, t.indexOf(b!) + b!.length];
          break;
        }
      }
      if (!start || !end) throw new Error(`texte introuvable : ${a} … ${b}`);
      const range = document.createRange();
      range.setStart(...start);
      range.setEnd(...end);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    },
    [from, to],
  );
}
