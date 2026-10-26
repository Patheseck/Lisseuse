import { openBook, type OpenedBook } from '../book/service';
import { errorMessage, logError } from '../core/errors';
import { anchorFromOffsets, anchorFromRange, locate, unwrap, wrapRange } from '../reader/anchor';
import { htmlToText, type SearchHit } from '../reader/search';
import { deleteCard, demoteCard, listCards, newCard, putCard, type CardRecord } from '../storage/cards';
import { editCard, type CardEditorOptions } from './card-editor';
import { nextFreeNumber } from '../core/mnemonic';
import { getProgress, saveProgress, touchBook } from '../storage/library';
import { loadMojorTable, loadReaderSettings } from '../storage/settings';
import { addRecall, listRecalls, markPretest, pretestDates, type RecallRecord } from '../storage/learning';
import { chapterHeadings, chapterRecall, pretest } from './chapter-practice';
import { clear, h } from './dom';
import { confirmDialog, toast } from './feedback';
import { icon } from './icons';
import { readerSearchSheet } from './reader-search';
import { readerSettingsSheet } from './reader-settings';
import { readerTocSheet } from './reader-toc';
import type { Navigate, Screen } from './screen';
import type { Sheet } from './sheet';

const SAVE_DELAY_MS = 400;
const SELECTION_DELAY_MS = 150;
const FLASH_MS = 2500;

export function readerScreen(bookId: string, navigate: Navigate): Screen {
  let opened: OpenedBook | null = null;
  let current = 0;
  let saveTimer: number | undefined;
  let selectionTimer: number | undefined;
  let texts: string[] | null = null;
  let cards: CardRecord[] = [];
  const orphans = new Set<string>();
  const resourceUrls = new Map<string, string>();
  const sheets: Sheet[] = [];
  const cleanup: (() => void)[] = [];

  // ---------- Structure ----------
  const bookTitle = h('span', { className: 'reader-book', 'data-testid': 'reader-title' }, 'Chargement…');
  const chapterTitle = h('span', { className: 'reader-chapter', 'data-testid': 'reader-chapter' });
  const content = h('article', { className: 'reader-content', 'data-testid': 'reader-content', lang: 'fr' });
  const pretestBox = h('aside', { className: 'chapter-box', 'data-testid': 'pretest-box', hidden: true });
  const chapterEnd = h('aside', { className: 'chapter-box chapter-end', 'data-testid': 'chapter-end', hidden: true });
  const scroller = h('main', { className: 'scroll reader-scroll' }, h('div', { className: 'reader-column' }, pretestBox, content, chapterEnd));
  const dismissedPretests = new Set<number>();
  const prev = h('button', { type: 'button', className: 'btn', 'data-testid': 'prev-chapter', 'aria-label': 'Chapitre précédent', onclick: () => go(current - 1) }, icon('chevronLeft'), 'Précédent');
  const next = h('button', { type: 'button', className: 'btn', 'data-testid': 'next-chapter', 'aria-label': 'Chapitre suivant', onclick: () => go(current + 1) }, 'Suivant', icon('chevronRight'));
  const position = h('span', { className: 'muted', 'data-testid': 'chapter-position' });
  const footer = h('footer', { className: 'bottombar' }, prev, position, next);
  const toolButtons = h('div', { className: 'reader-tools' });
  const exitFocus = h('button', { type: 'button', className: 'icon-btn focus-exit', 'aria-label': 'Quitter le mode concentration', 'data-testid': 'exit-focus', onclick: () => setFocus(false) }, icon('focus'));
  const selectionBar = h('div', { className: 'selection-bar', role: 'toolbar', 'aria-label': 'Actions sur la sélection', hidden: true },
    h('button', { type: 'button', className: 'btn', 'data-testid': 'highlight-selection', onmousedown: (e: Event) => e.preventDefault(), onclick: () => void highlightSelection(false) }, icon('highlight'), 'Surligner'),
    h('button', { type: 'button', className: 'btn btn-primary', 'data-testid': 'card-from-selection', onmousedown: (e: Event) => e.preventDefault(), onclick: () => void highlightSelection(true) }, icon('card'), 'Créer une fiche'),
  );
  const markMenu = h('div', { className: 'mark-menu', role: 'dialog', 'aria-label': 'Surlignage', hidden: true });
  footer.hidden = true;
  toolButtons.hidden = true;

  const el = h('div', { className: 'screen reader' },
    h('header', { className: 'topbar' },
      h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Retour à la bibliothèque', 'data-testid': 'back', onclick: () => navigate({ name: 'library' }) }, icon('back')),
      h('div', { className: 'reader-heading' }, bookTitle, chapterTitle),
      toolButtons,
    ),
    scroller,
    footer,
    exitFocus,
    selectionBar,
    markMenu,
  );

  // ---------- Ressources et rendu ----------
  function resourceUrl(path: string): string | undefined {
    let url = resourceUrls.get(path);
    const blob = opened?.resources[path];
    if (!url && blob) {
      url = URL.createObjectURL(blob);
      resourceUrls.set(path, url);
    }
    return url;
  }

  function chapterTexts(): string[] {
    texts ??= opened ? opened.chapters.map((c) => htmlToText(c.html)) : [];
    return texts;
  }

  function offset(): number {
    const max = scroller.scrollHeight - scroller.clientHeight;
    // Un chapitre qui tient entièrement à l'écran est considéré comme lu.
    return max > 0 ? scroller.scrollTop / max : 1;
  }

  function persist(): void {
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
    if (opened) saveProgress(bookId, current, offset()).catch((err: unknown) => logError('progression', err));
  }

  function paintHighlights(): void {
    unwrap(content, 'mark.hl');
    const text = content.textContent ?? '';
    for (const card of cards.filter((c) => c.chapter === current)) {
      const found = locate(text, card.anchor);
      if (!found) {
        orphans.add(card.id);
        continue;
      }
      orphans.delete(card.id);
      wrapRange(content, found.start, found.end, () => markFor(card));
      if (found.start !== card.anchor.start || found.end !== card.anchor.end) {
        // Le passage a bougé (nouvelle analyse du livre, données V5) : on mémorise sa nouvelle position.
        card.anchor = anchorFromOffsets(text, found.start, found.end);
        putCard({ ...card, updatedAt: Date.now() }).catch((err: unknown) => logError('surlignage', err));
      }
    }
  }

  function go(index: number, opts: { offset?: number; after?: () => void } = {}): void {
    if (!opened || index < 0 || index >= opened.chapters.length) return;
    current = index;
    hideSelectionBar();
    hideMarkMenu();
    const chapter = opened.chapters[index]!;
    content.innerHTML = chapter.html; // HTML déjà nettoyé par DOMPurify à l'import
    content.querySelectorAll<HTMLImageElement>('img[data-res]').forEach((img) => {
      const url = resourceUrl(img.dataset.res ?? '');
      if (url) img.src = url;
    });
    paintHighlights();
    chapterTitle.textContent = chapter.label;
    position.textContent = `${index + 1} / ${opened.chapters.length}`;
    prev.disabled = index === 0;
    next.disabled = index === opened.chapters.length - 1;
    void renderChapterExtras(index);
    requestAnimationFrame(() => {
      const max = scroller.scrollHeight - scroller.clientHeight;
      scroller.scrollTop = Math.max(0, (opts.offset ?? 0) * max);
      opts.after?.();
      persist();
    });
  }

  // ---------- Exercices de chapitre : pré-questions et rappel libre ----------
  const PRETEST_GAP_MS = 12 * 3600 * 1000;
  const PRETEST_MAX = 5;

  function chapterCards(index: number): CardRecord[] {
    return cards.filter((c) => c.chapter === index);
  }

  async function renderChapterExtras(index: number): Promise<void> {
    const [recalls, pretests] = await Promise.all([listRecalls(bookId), pretestDates(bookId)]).catch(() => [[], {}] as [RecallRecord[], Record<string, number>]);
    if (index !== current) return;
    const questions = chapterCards(index).filter((c) => c.kind !== 'highlight');
    const last = pretests[index];
    clear(pretestBox);
    pretestBox.hidden = !(questions.length && !dismissedPretests.has(index) && (!last || Date.now() - last > PRETEST_GAP_MS));
    if (!pretestBox.hidden) {
      const n = Math.min(PRETEST_MAX, questions.length);
      pretestBox.append(
        h('p', {}, h('strong', {}, 'Avant de relire ce chapitre'), ` : ${n} question${n > 1 ? 's' : ''} (≈ 1 min). Se tester avant de lire aide à mieux retenir, même en se trompant.`),
        h('div', { className: 'chapter-box-actions' },
          h('button', { type: 'button', className: 'btn', onclick: () => { dismissedPretests.add(index); pretestBox.hidden = true; } }, 'Plus tard'),
          h('button', { type: 'button', className: 'btn btn-primary', 'data-testid': 'start-pretest', onclick: () => void runPretest(index) }, 'Me tester'),
        ),
      );
    }
    const previous = recalls.filter((r) => r.chapter === index).at(-1);
    clear(chapterEnd);
    chapterEnd.hidden = false;
    chapterEnd.append(
      h('p', {}, h('strong', {}, 'Fin du chapitre.'), ' Avant de continuer : 2 minutes pour écrire ce dont tu te souviens, sans regarder.'),
      previous ? h('p', { className: 'hint' }, `Dernier rappel : ${previous.found} / ${previous.total} idées retrouvées, le ${new Date(previous.at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}.`) : '',
      h('div', { className: 'chapter-box-actions' },
        h('button', { type: 'button', className: 'btn btn-primary', 'data-testid': 'start-recall', onclick: () => void runRecall(index) }, icon('timer'), 'Faire un rappel libre'),
      ),
    );
  }

  async function runPretest(index: number): Promise<void> {
    const questions = chapterCards(index).filter((c) => c.kind !== 'highlight').sort(() => Math.random() - 0.5).slice(0, PRETEST_MAX);
    const completed = await pretest(questions);
    dismissedPretests.add(index);
    pretestBox.hidden = true;
    if (completed) await markPretest(bookId, index).catch((err: unknown) => logError('pré-questions', err));
  }

  async function runRecall(index: number): Promise<void> {
    const result = await chapterRecall({
      chapterLabel: opened?.chapters[index]?.label ?? `Chapitre ${index + 1}`,
      passages: chapterCards(index),
      headings: chapterHeadings(opened?.chapters[index]?.html ?? ''),
      onCreateCard: (card) => void openEditor(card),
    });
    if (!result) return;
    try {
      await addRecall(bookId, { chapter: index, at: Date.now(), ...result });
      toast(result.total ? `Rappel enregistré : ${result.found} / ${result.total} idées retrouvées.` : 'Rappel enregistré.');
      if (index === current) void renderChapterExtras(index);
    } catch (err) {
      logError('rappel libre', err);
      toast(`Rappel non enregistré : ${errorMessage(err)}`, 'error');
    }
  }

  function flash(start: number, end: number): void {
    unwrap(content, 'mark.flash');
    const marks = wrapRange(content, start, end, () => h('mark', { className: 'flash' }));
    marks[0]?.scrollIntoView({ block: 'center' });
    window.setTimeout(() => unwrap(content, 'mark.flash'), FLASH_MS);
  }

  // ---------- Surlignage ----------
  function currentSelectionRange(): Range | null {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    return content.contains(range.commonAncestorContainer) ? range : null;
  }

  function hideSelectionBar(): void {
    selectionBar.hidden = true;
  }

  function updateSelectionBar(): void {
    const range = currentSelectionRange();
    if (!range || !range.toString().trim()) {
      hideSelectionBar();
      return;
    }
    const rect = range.getBoundingClientRect();
    selectionBar.hidden = false;
    // Sous la sélection : le menu natif d'Android s'affiche au-dessus.
    const top = Math.min(window.innerHeight - selectionBar.offsetHeight - 12, rect.bottom + 12);
    const left = Math.min(window.innerWidth - selectionBar.offsetWidth - 12, Math.max(12, rect.left + rect.width / 2 - selectionBar.offsetWidth / 2));
    selectionBar.style.top = `${Math.max(12, top)}px`;
    selectionBar.style.left = `${left}px`;
  }

  async function editorOptions(): Promise<CardEditorOptions> {
    const mojor = await loadMojorTable().catch(() => new Map());
    return { mojor, suggestedNumber: nextFreeNumber(cards.map((c) => c.mnemonic?.number)) };
  }

  function markFor(card: CardRecord): HTMLElement {
    return h('mark', { className: card.kind === 'highlight' ? 'hl' : 'hl hl-card', 'data-card-id': card.id, tabindex: 0 });
  }

  function sortCards(): void {
    cards.sort((a, b) => a.chapter - b.chapter || a.anchor.start - b.anchor.start);
  }

  /** Redessine les marques d'une fiche du chapitre affiché (après création ou modification). */
  function repaint(card: CardRecord): void {
    unwrap(content, `mark.hl[data-card-id="${CSS.escape(card.id)}"]`);
    if (card.chapter !== current) return;
    const found = locate(content.textContent ?? '', card.anchor);
    if (found) wrapRange(content, found.start, found.end, () => markFor(card));
  }

  /** Surligne la sélection ; avec `asCard`, ouvre aussitôt l'éditeur de fiche. */
  async function highlightSelection(asCard: boolean): Promise<void> {
    const range = currentSelectionRange();
    // Les marques existantes ne changent pas le texte : les positions restent exactes.
    const anchor = range ? anchorFromRange(content, range) : null;
    hideSelectionBar();
    if (!anchor) return;
    window.getSelection()?.removeAllRanges();
    const overlapping = cards.find((c) => c.chapter === current && !orphans.has(c.id) && c.anchor.start < anchor.end && anchor.start < c.anchor.end);
    if (overlapping) {
      toast('Ce passage chevauche un surlignage existant.');
      return;
    }
    let card = newCard(bookId, current, anchor);
    if (asCard) {
      const edited = await editCard(card, await editorOptions());
      if (!edited) return;
      card = edited.card;
    }
    try {
      await putCard(card);
      cards.push(card);
      sortCards();
      repaint(card);
      if (asCard) toast('Fiche créée : elle te sera proposée en révision.');
    } catch (err) {
      logError('surlignage', err);
      toast(`Enregistrement impossible : ${errorMessage(err)}`, 'error');
    }
  }

  async function openEditor(card: CardRecord): Promise<void> {
    hideMarkMenu();
    const edited = await editCard(card, await editorOptions());
    if (!edited) return;
    try {
      if (edited.action === 'demote') await demoteCard(edited.card);
      else await putCard(edited.card);
      cards = cards.map((c) => (c.id === card.id ? edited.card : c));
      repaint(edited.card);
      toc.refresh();
    } catch (err) {
      logError('fiche', err);
      toast(`Enregistrement impossible : ${errorMessage(err)}`, 'error');
    }
  }

  async function removeCard(card: CardRecord): Promise<void> {
    hideMarkMenu();
    if (card.kind !== 'highlight') {
      const ok = await confirmDialog({
        title: 'Retirer ce passage ?',
        message: 'Le surlignage et sa fiche seront supprimés, avec son historique de révision.',
        confirmLabel: 'Retirer',
        danger: true,
      });
      if (!ok) return;
    }
    try {
      await deleteCard(card.id);
      cards = cards.filter((c) => c.id !== card.id);
      orphans.delete(card.id);
      unwrap(content, `mark.hl[data-card-id="${CSS.escape(card.id)}"]`);
      toc.refresh();
    } catch (err) {
      logError('surlignage', err);
      toast(`Suppression impossible : ${errorMessage(err)}`, 'error');
    }
  }

  function hideMarkMenu(): void {
    markMenu.hidden = true;
  }

  function showMarkMenu(mark: HTMLElement): void {
    const card = cards.find((c) => c.id === mark.dataset.cardId);
    if (!card) return;
    clear(markMenu);
    markMenu.append(
      h('button', { type: 'button', className: 'btn btn-primary', 'data-testid': 'edit-card', onclick: () => void openEditor(card) }, icon('card'), card.kind === 'highlight' ? 'Créer une fiche' : 'Modifier la fiche'),
      h('button', { type: 'button', className: 'btn', 'data-testid': 'remove-highlight', 'aria-label': 'Retirer le surlignage', onclick: () => void removeCard(card) }, icon('trash')),
    );
    markMenu.hidden = false;
    const rect = mark.getBoundingClientRect();
    markMenu.style.top = `${Math.min(window.innerHeight - markMenu.offsetHeight - 12, rect.bottom + 8)}px`;
    markMenu.style.left = `${Math.min(window.innerWidth - markMenu.offsetWidth - 12, Math.max(12, rect.left))}px`;
    (markMenu.querySelector('button') as HTMLButtonElement).focus();
  }

  // ---------- Panneaux ----------
  const toc = readerTocSheet({
    labels: () => opened?.chapters.map((c) => c.label) ?? [],
    current: () => current,
    cards: () => cards,
    orphans: () => orphans,
    onChapter: (i) => go(i),
    onCard: (card) => {
      const goToCard = () => {
        const found = locate(content.textContent ?? '', card.anchor);
        if (found) flash(found.start, found.end);
        else toast('Ce passage n’a pas été retrouvé dans le texte.');
      };
      if (card.chapter === current) goToCard();
      else go(card.chapter, { after: goToCard });
    },
    onEditCard: (card) => void openEditor(card),
    onDeleteCard: (card) => void removeCard(card),
  });
  const search = readerSearchSheet({
    texts: chapterTexts,
    chapterLabel: (i) => opened?.chapters[i]?.label ?? `Chapitre ${i + 1}`,
    onPick: (hit: SearchHit) => go(hit.chapter, { after: () => flash(hit.start, hit.end) }),
  });
  sheets.push(toc, search);
  let settingsSheet: Sheet | null = null;

  async function openSettings(): Promise<void> {
    if (!settingsSheet) {
      settingsSheet = readerSettingsSheet(await loadReaderSettings());
      sheets.push(settingsSheet);
    }
    settingsSheet.open();
  }

  function setFocus(on: boolean): void {
    el.classList.toggle('focus-mode', on);
    if (on) toast('Mode concentration : touche l’icône en haut à droite pour en sortir.', 'info', 2500);
  }

  toolButtons.append(
    h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Rechercher dans le livre', 'data-testid': 'open-search', onclick: () => search.open() }, icon('search')),
    h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Sommaire et surlignages', 'data-testid': 'open-toc', onclick: () => toc.open() }, icon('toc')),
    h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Réglages d’affichage', 'data-testid': 'open-settings', onclick: () => void openSettings() }, icon('text')),
    h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Mode concentration', 'data-testid': 'focus-mode', onclick: () => setFocus(true) }, icon('focus')),
  );

  // ---------- Événements ----------
  content.addEventListener('click', (e) => {
    const target = e.target as Element;
    const mark = target.closest<HTMLElement>('mark.hl');
    if (mark && !currentSelectionRange()) {
      showMarkMenu(mark);
      return;
    }
    // Liens internes du livre (convertis à l'import en data-chapter / data-anchor).
    const link = target.closest<HTMLElement>('a[data-chapter], a[data-anchor]');
    if (!link) return;
    e.preventDefault();
    const chapter = link.dataset.chapter !== undefined ? Number(link.dataset.chapter) : current;
    const anchor = link.dataset.anchor;
    const reveal = () => {
      if (anchor) content.querySelector(`[data-anchor-id="${CSS.escape(anchor)}"]`)?.scrollIntoView();
    };
    if (chapter !== current) go(chapter, { after: reveal });
    else reveal();
  });
  content.addEventListener('keydown', (e) => {
    const mark = (e.target as Element).closest?.<HTMLElement>('mark.hl');
    if (mark && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      showMarkMenu(mark);
    }
  });

  scroller.addEventListener('scroll', () => {
    hideMarkMenu();
    if (!selectionBar.hidden) updateSelectionBar();
    if (saveTimer === undefined) saveTimer = window.setTimeout(persist, SAVE_DELAY_MS);
  }, { passive: true });

  const onSelectionChange = () => {
    window.clearTimeout(selectionTimer);
    selectionTimer = window.setTimeout(updateSelectionBar, SELECTION_DELAY_MS);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (sheets.some((s) => s.isOpen) || (e.target as Element).closest?.('input, textarea, select')) return;
    if (e.key === 'Escape') {
      hideMarkMenu();
      setFocus(false);
    } else if (e.key === 'ArrowLeft' && !e.altKey) go(current - 1);
    else if (e.key === 'ArrowRight' && !e.altKey) go(current + 1);
  };
  const onPointerDown = (e: PointerEvent) => {
    if (!markMenu.hidden && !markMenu.contains(e.target as Node) && !(e.target as Element).closest('mark.hl')) hideMarkMenu();
  };
  document.addEventListener('selectionchange', onSelectionChange);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('pointerdown', onPointerDown);
  cleanup.push(
    () => document.removeEventListener('selectionchange', onSelectionChange),
    () => document.removeEventListener('keydown', onKeyDown),
    () => document.removeEventListener('pointerdown', onPointerDown),
  );

  // ---------- Ouverture ----------
  (async () => {
    opened = await openBook(bookId);
    cards = await listCards(bookId);
    bookTitle.textContent = opened.book.title;
    footer.hidden = false;
    toolButtons.hidden = false;
    const progress = await getProgress(bookId);
    const start = Math.min(Math.max(0, progress?.chapter ?? 0), opened.chapters.length - 1);
    go(start, { offset: progress?.offset ?? 0 });
    await touchBook(bookId);
  })().catch((err: unknown) => {
    logError('ouverture', err);
    bookTitle.textContent = 'Livre illisible';
    clear(content);
    content.append(h('p', { className: 'error-box' }, `Impossible d’ouvrir ce livre : ${errorMessage(err)}`));
    toast('Ce livre n’a pas pu être ouvert.', 'error');
  });

  return {
    el,
    destroy() {
      if (saveTimer !== undefined) persist();
      window.clearTimeout(selectionTimer);
      cleanup.forEach((fn) => fn());
      sheets.forEach((s) => s.el.remove());
      resourceUrls.forEach((u) => URL.revokeObjectURL(u));
      resourceUrls.clear();
    },
  };
}
