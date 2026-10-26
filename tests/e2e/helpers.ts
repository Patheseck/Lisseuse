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

/** Tap sur la zone de lecture à une position relative (0 à 1). */
export async function tapReader(page: Page, xFrac: number, yFrac = 0.5): Promise<void> {
  const box = (await page.locator('.reader-scroll').boundingBox())!;
  await page.mouse.click(box.x + box.width * xFrac, box.y + box.height * yFrac);
}

/** Cache les menus du lecteur s'ils sont affichés (tap au centre). */
export async function hideChrome(page: Page): Promise<void> {
  if (!(await page.locator('.reader.chrome-hidden').count())) await tapReader(page, 0.5);
  await page.locator('.reader.chrome-hidden').waitFor();
}

/** Affiche les menus du lecteur s'ils sont cachés. */
export async function showChrome(page: Page): Promise<void> {
  if (await page.locator('.reader.chrome-hidden').count()) await tapReader(page, 0.5);
  await page.locator('header.reader-chrome').waitFor({ state: 'visible' });
}

/**
 * Geste tactile simulé (événements pointeur de type « touch ») sur la zone de lecture,
 * de (x0, y0) à (x1, y1) en positions relatives.
 */
export async function touchDrag(page: Page, from: [number, number], to: [number, number], durationMs = 120): Promise<void> {
  await page.locator('.reader-scroll').evaluate(
    async (el, [f, t, ms]) => {
      const r = el.getBoundingClientRect();
      const at = (p: number[]) => ({ clientX: r.left + r.width * p[0]!, clientY: r.top + r.height * p[1]! });
      const fire = (type: string, p: number[]) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, ...at(p) }));
      fire('pointerdown', f as number[]);
      const steps = 6;
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        fire('pointermove', [f![0]! + (t![0]! - f![0]!) * k, f![1]! + (t![1]! - f![1]!) * k]);
        await new Promise((res) => setTimeout(res, (ms as number) / steps));
      }
      fire('pointerup', t as number[]);
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, ...at(t as number[]) }));
    },
    [from, to, durationMs] as const,
  );
}
