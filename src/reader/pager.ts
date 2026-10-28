import type { ReaderLayout } from '../storage/settings';

// Mise en page du chapitre : vraies pages (colonnes CSS, une colonne = un écran) ou
// défilement continu. Les deux modes partagent la même notion de position (0 à 1).
//
// Le glissement des pages est animé image par image (requestAnimationFrame) et non par une
// transition CSS : sur une colonne très large (long chapitre), Chromium repeint tout le chapitre
// au début de chaque animation CSS, ce qui figeait l'écran (0,7 s par page sur ordinateur pour
// 500 pages). Image par image, une page se tourne en une trame quelle que soit la longueur.

const TURN_MS = 280;
const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);

function cssLength(value: string, rootPx: number): number {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return 0;
  return value.trim().endsWith('rem') ? n * rootPx : n;
}

export class Pager {
  mode: ReaderLayout = 'paged';
  page = 0;
  pages = 1;
  private width = 0;
  private dragX = 0;
  /** Décalage horizontal affiché (px), y compris pendant une animation. */
  private shownX = 0;
  private frame: number | undefined;

  constructor(
    private readonly scroller: HTMLElement,
    private readonly column: HTMLElement,
    private readonly onChange: () => void,
  ) {}

  setMode(mode: ReaderLayout): void {
    if (mode === this.mode && this.scroller.classList.contains(`layout-${mode}`)) return;
    const keep = this.offset();
    this.mode = mode;
    this.scroller.classList.toggle('layout-paged', mode === 'paged');
    this.scroller.classList.toggle('layout-scroll', mode === 'scroll');
    this.relayout(keep);
  }

  /** Recalcule la pagination (taille d'écran, police, contenu) en gardant la position. */
  relayout(keep = this.offset()): void {
    const style = this.column.style;
    if (this.mode === 'scroll') {
      this.stopAnimation();
      this.shownX = 0;
      for (const prop of ['width', 'column-width', 'column-gap', 'padding-left', 'padding-right', 'transform']) style.removeProperty(prop);
      this.pages = 1;
      this.page = 0;
      this.restore(keep);
      return;
    }
    const rootPx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const vars = getComputedStyle(document.documentElement);
    const W = this.scroller.clientWidth;
    const measure = cssLength(vars.getPropertyValue('--reader-measure') || '40rem', rootPx);
    const margin = cssLength(vars.getPropertyValue('--page-margin') || '1.4rem', rootPx);
    // Marges minimales, et colonne de texte limitée à une longueur de ligne confortable.
    const padX = Math.max(margin, (W - measure) / 2);
    this.width = W;
    style.width = `${W}px`;
    style.paddingLeft = `${padX}px`;
    style.paddingRight = `${padX}px`;
    style.columnWidth = `${W - 2 * padX}px`;
    style.columnGap = `${2 * padX}px`;
    this.pages = Math.max(1, Math.round(this.column.scrollWidth / W));
    this.restore(keep);
  }

  /** Position dans le chapitre, de 0 à 1. Un chapitre tenant sur un écran compte comme lu. */
  offset(): number {
    if (this.mode === 'paged') return this.pages > 1 ? this.page / (this.pages - 1) : 1;
    const max = this.scroller.scrollHeight - this.scroller.clientHeight;
    return max > 0 ? this.scroller.scrollTop / max : 1;
  }

  restore(offset: number): void {
    const o = Math.min(1, Math.max(0, offset));
    if (this.mode === 'paged') {
      this.goTo(Math.round(o * (this.pages - 1)), false);
    } else {
      const max = this.scroller.scrollHeight - this.scroller.clientHeight;
      this.scroller.scrollTop = Math.max(0, o * max);
    }
  }

  goTo(page: number, animate = true): void {
    this.page = Math.min(this.pages - 1, Math.max(0, page));
    this.dragX = 0;
    if (animate) this.animateTo(this.targetX());
    else this.setX(this.targetX());
    this.onChange();
  }

  /** Page suivante ; false en fin de chapitre (au lecteur de passer au suivant). */
  next(): boolean {
    if (this.mode === 'paged') {
      if (this.page >= this.pages - 1) return false;
      this.goTo(this.page + 1);
      return true;
    }
    const max = this.scroller.scrollHeight - this.scroller.clientHeight;
    if (this.scroller.scrollTop >= max - 2) return false;
    this.scroller.scrollBy({ top: this.scroller.clientHeight * 0.9, behavior: 'smooth' });
    return true;
  }

  prev(): boolean {
    if (this.mode === 'paged') {
      if (this.page <= 0) return false;
      this.goTo(this.page - 1);
      return true;
    }
    if (this.scroller.scrollTop <= 2) return false;
    this.scroller.scrollBy({ top: -this.scroller.clientHeight * 0.9, behavior: 'smooth' });
    return true;
  }

  // ---------- Glisser (mode pages) ----------

  drag(dx: number): void {
    // Résistance au-delà de la première et de la dernière page.
    const atEdge = (dx > 0 && this.page === 0) || (dx < 0 && this.page === this.pages - 1);
    this.dragX = atEdge ? dx * 0.35 : dx;
    this.setX(this.targetX());
  }

  /** Fin du glisser : tourne la page si le geste est assez ample ou rapide. Renvoie la direction, ou 0. */
  release(dx: number, velocity: number): -1 | 0 | 1 {
    const decisive = Math.abs(dx) > this.width * 0.18 || Math.abs(velocity) > 0.45;
    const dir = decisive ? (dx < 0 ? 1 : -1) : 0;
    if (dir === 1 && this.page < this.pages - 1) {
      this.goTo(this.page + 1);
      return 1;
    }
    if (dir === -1 && this.page > 0) {
      this.goTo(this.page - 1);
      return -1;
    }
    this.dragX = 0;
    this.animateTo(this.targetX());
    return dir === 0 ? 0 : (dir as -1 | 1); // bord du chapitre : le lecteur décide
  }

  // ---------- Éléments ----------

  /** Page contenant l'élément (mode pages). */
  pageOf(el: Element): number {
    const left = el.getBoundingClientRect().left - this.column.getBoundingClientRect().left;
    return Math.min(this.pages - 1, Math.max(0, Math.floor((left + 1) / (this.width || 1))));
  }

  /** Amène un élément à l'écran. */
  reveal(el: Element, smooth = false): void {
    if (this.mode === 'paged') this.goTo(this.pageOf(el), smooth);
    else el.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
  }

  /** Index du premier élément visible à l'écran. */
  firstVisible(elements: Element[]): number {
    if (this.mode === 'paged') return Math.max(0, elements.findIndex((e) => this.pageOf(e) >= this.page));
    const top = this.scroller.getBoundingClientRect().top;
    return Math.max(0, elements.findIndex((e) => e.getBoundingClientRect().bottom > top + 8));
  }

  private targetX(): number {
    return -this.page * this.width + this.dragX;
  }

  private stopAnimation(): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
  }

  private setX(x: number): void {
    this.stopAnimation();
    this.paint(x);
  }

  private paint(x: number): void {
    this.shownX = x;
    if (this.mode === 'paged') this.column.style.transform = `translate3d(${x}px, 0, 0)`;
  }

  /** Glisse jusqu'à `to` depuis la position affichée (reprend une animation en cours sans à-coup). */
  private animateTo(to: number): void {
    this.stopAnimation();
    const from = this.shownX;
    if (this.mode !== 'paged' || from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.paint(to);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / TURN_MS);
      this.paint(from + (to - from) * easeOut(k));
      this.frame = k < 1 ? requestAnimationFrame(step) : undefined;
    };
    this.frame = requestAnimationFrame(step);
  }

}
