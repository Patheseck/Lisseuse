import { openBook, type OpenedBook } from '../book/service';
import { errorMessage, logError } from '../core/errors';
import { anchorFromOffsets, anchorFromRange, locate, unwrap, wrapRange } from '../reader/anchor';
import { htmlToText, type SearchHit } from '../reader/search';
import { deleteCard, demoteCard, listAllCards, listCards, newCard, putCard, type CardRecord } from '../storage/cards';
import { editCard, type CardEditorOptions } from './card-editor';
import { nextFreeNumber } from '../core/mnemonic';
import { getProgress, saveProgress, touchBook } from '../storage/library';
import { applyReaderSettings, loadMojorTable, loadReaderSettings, saveReaderSettings, BRIGHTNESS_RANGE, type ReaderSettings } from '../storage/settings';
import { Pager } from '../reader/pager';
import { applyReaderNative, chapterTick, onVolumeKey, setImmersive } from '../native/reader-native';
import { addRecall, listRecalls, markPretest, pretestDates, type RecallRecord } from '../storage/learning';
import { chapterHeadings, chapterRecall, pretest } from './chapter-practice';
import { clear, h } from './dom';
import { confirmDialog, toast } from './feedback';
import { speak, stop as stopSpeech, ttsAvailable } from '../native/tts';
import { icon } from './icons';
import { readerSearchSheet } from './reader-search';
import { readerSettingsSheet } from './reader-settings';
import { readerTocSheet } from './reader-toc';
import type { Navigate, Screen } from './screen';
import type { Sheet } from './sheet';

const SAVE_DELAY_MS = 400;
const SELECTION_DELAY_MS = 150;
const FLASH_MS = 2500;
const WORDS_PER_MINUTE = 230;
/** Zones de tap : le tiers gauche recule, le tiers droit avance, le centre affiche les menus. */
const TAP_EDGE = 0.3;
/** Bande du bord gauche où un glisser vertical règle la luminosité (mode pages). */
const BRIGHTNESS_EDGE = 0.14;

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
  const column = h('div', { className: 'reader-column' }, pretestBox, content, chapterEnd);
  const scroller = h('main', { className: 'scroll reader-scroll' }, column);
  const pager = new Pager(scroller, column, () => onPositionChange());
  let settings: ReaderSettings | null = null;
  // Barre d'état discrète, toujours visible : page, heure, progression, temps restant.
  const statusPage = h('span', { 'data-testid': 'status-page' });
  const statusClock = h('span', { 'data-testid': 'status-clock' });
  const statusProgress = h('span', { 'data-testid': 'status-progress' });
  const statusBar = h('div', { className: 'status-bar', 'aria-hidden': 'true' }, statusPage, statusClock, statusProgress);
  const dim = h('div', { className: 'dim-layer', 'aria-hidden': 'true' });
  const brightnessBadge = h('div', { className: 'brightness-badge', 'data-testid': 'brightness-badge', hidden: true });
  const dismissedPretests = new Set<number>();
  const prev = h('button', { type: 'button', className: 'btn', 'data-testid': 'prev-chapter', 'aria-label': 'Chapitre précédent', onclick: () => go(current - 1) }, icon('chevronLeft'), 'Précédent');
  const next = h('button', { type: 'button', className: 'btn', 'data-testid': 'next-chapter', 'aria-label': 'Chapitre suivant', onclick: () => go(current + 1) }, 'Suivant', icon('chevronRight'));
  const position = h('span', { className: 'muted', 'data-testid': 'chapter-position' });
  const footer = h('footer', { className: 'bottombar' }, prev, position, next);
  const toolButtons = h('div', { className: 'reader-tools' });
  const selectionBar = h('div', { className: 'selection-bar', role: 'toolbar', 'aria-label': 'Actions sur la sélection', hidden: true },
    h('button', { type: 'button', className: 'btn', 'data-testid': 'highlight-selection', onmousedown: (e: Event) => e.preventDefault(), onclick: () => void highlightSelection(false) }, icon('highlight'), 'Surligner'),
    h('button', { type: 'button', className: 'btn btn-primary', 'data-testid': 'card-from-selection', onmousedown: (e: Event) => e.preventDefault(), onclick: () => void highlightSelection(true) }, icon('card'), 'Créer une fiche'),
  );
  const markMenu = h('div', { className: 'mark-menu', role: 'dialog', 'aria-label': 'Surlignage', hidden: true });
  footer.hidden = true;
  toolButtons.hidden = true;

  const el = h('div', { className: 'screen reader' },
    h('header', { className: 'topbar reader-chrome' },
      h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Retour à la bibliothèque', 'data-testid': 'back', onclick: () => navigate({ name: 'library' }) }, icon('back')),
      h('div', { className: 'reader-heading' }, bookTitle, chapterTitle),
      toolButtons,
    ),
    scroller,
    statusBar,
    footer,
    dim,
    brightnessBadge,
    selectionBar,
    markMenu,
  );
  footer.classList.add('reader-chrome');

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
    return pager.offset();
  }

  // ---------- Position, barre d'état, menus ----------
  function chapterWords(index: number): number {
    return (chapterTexts()[index] ?? '').split(/\s+/).filter(Boolean).length;
  }

  function updateStatus(): void {
    if (!opened) return;
    const o = offset();
    statusPage.textContent = pager.mode === 'paged' ? `${pager.page + 1} / ${pager.pages}` : `${Math.round(o * 100)} %`;
    statusClock.textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const book = Math.round(((current + o) / opened.chapters.length) * 100);
    const minutes = Math.round((chapterWords(current) * (1 - o)) / WORDS_PER_MINUTE);
    statusProgress.textContent = `${book} %${o < 1 ? ` · ${minutes < 1 ? '< 1' : minutes} min` : ''}`;
  }

  function onPositionChange(): void {
    hideMarkMenu();
    if (!selectionBar.hidden) updateSelectionBar();
    updateStatus();
    if (saveTimer === undefined) saveTimer = window.setTimeout(persist, SAVE_DELAY_MS);
  }

  /** Menus en surimpression : visibles à l'ouverture, cachés dès qu'on lit. */
  function setChrome(visible: boolean): void {
    el.classList.toggle('chrome-hidden', !visible);
    void setImmersive(!visible);
  }

  function chromeVisible(): boolean {
    return !el.classList.contains('chrome-hidden');
  }

  function turn(dir: 1 | -1): void {
    if (chromeVisible()) setChrome(false);
    const moved = dir === 1 ? pager.next() : pager.prev();
    if (moved) return;
    // Bord du chapitre : on enchaîne sur le suivant, ou sur la fin du précédent.
    const target = current + dir;
    if (!opened || target < 0 || target >= opened.chapters.length) return;
    void chapterTick();
    go(target, { offset: dir === 1 ? 0 : 1 });
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
    void stopListening();
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
      pager.relayout(opts.offset ?? 0);
      opts.after?.();
      persist();
      updateStatus();
    });
    // Les images changent la pagination une fois chargées.
    content.querySelectorAll('img').forEach((img) => img.addEventListener('load', () => pager.relayout(), { once: true }));
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
    if (marks[0]) pager.reveal(marks[0]);
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

  /** Options de l'éditeur ; `editing` est exclue de la recherche de doublons. */
  async function editorOptions(editing: CardRecord): Promise<CardEditorOptions> {
    const [mojor, all] = await Promise.all([loadMojorTable().catch(() => new Map()), listAllCards().catch(() => cards)]);
    return {
      mojor,
      suggestedNumber: nextFreeNumber(cards.map((c) => c.mnemonic?.number)),
      otherQuestions: all.filter((c) => c.kind !== 'highlight' && c.id !== editing.id).map((c) => c.question),
    };
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
      const edited = await editCard(card, await editorOptions(card));
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
    const edited = await editCard(card, await editorOptions(card));
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

  // ---------- Lecture à voix haute ----------
  let speaking = false;
  const listenButton = h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Écouter le chapitre', 'aria-pressed': 'false', 'data-testid': 'listen', hidden: !ttsAvailable(), onclick: () => void toggleListen() }, icon('speaker'));

  function readableBlocks(): HTMLElement[] {
    return Array.from(content.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6, p, li, blockquote, pre'))
      .filter((el) => !el.querySelector('p, li, h1, h2, h3, h4, blockquote') && el.textContent?.trim());
  }

  function setSpeaking(on: boolean): void {
    speaking = on;
    listenButton.setAttribute('aria-pressed', String(on));
    listenButton.setAttribute('aria-label', on ? 'Arrêter la lecture' : 'Écouter le chapitre');
    listenButton.replaceChildren(icon(on ? 'stop' : 'speaker'));
    if (!on) content.querySelectorAll('.speaking').forEach((el) => el.classList.remove('speaking'));
  }

  async function stopListening(): Promise<void> {
    if (!speaking) return;
    setSpeaking(false);
    await stopSpeech();
  }

  async function toggleListen(): Promise<void> {
    if (speaking) return stopListening();
    const blocks = readableBlocks();
    // On commence au premier paragraphe visible.
    const queue = blocks.slice(pager.firstVisible(blocks));
    if (!queue.length) return;
    setSpeaking(true);
    try {
      await speak(queue.map((b) => b.textContent ?? ''), (i) => {
        content.querySelectorAll('.speaking').forEach((el) => el.classList.remove('speaking'));
        queue[i]!.classList.add('speaking');
        pager.reveal(queue[i]!, true);
      });
    } catch (err) {
      logError('lecture audio', err);
      toast('La lecture à voix haute n’est pas disponible sur cet appareil.', 'error');
    } finally {
      if (speaking) setSpeaking(false);
    }
  }

  async function openSettings(): Promise<void> {
    if (!settingsSheet) {
      settingsSheet = readerSettingsSheet(settings ?? (await loadReaderSettings()), { onChange: applySettings });
      sheets.push(settingsSheet);
    }
    settingsSheet.open();
  }

  /** Réglages modifiés dans « Aa » : mise en page, puis options Android. */
  function applySettings(next: ReaderSettings): void {
    const layoutChanged = settings?.layout !== next.layout;
    settings = next;
    if (layoutChanged) pager.setMode(next.layout);
    else requestAnimationFrame(() => pager.relayout());
    void applyReaderNative(next);
    updateStatus();
  }

  toolButtons.append(
    h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Rechercher dans le livre', 'data-testid': 'open-search', onclick: () => search.open() }, icon('search')),
    h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Sommaire et surlignages', 'data-testid': 'open-toc', onclick: () => toc.open() }, icon('toc')),
    listenButton,
    h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Réglages d’affichage', 'data-testid': 'open-settings', onclick: () => void openSettings() }, icon('text')),
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
      const target = anchor ? content.querySelector(`[data-anchor-id="${CSS.escape(anchor)}"]`) : null;
      if (target) pager.reveal(target);
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

  let lastScrollTop = 0;
  scroller.addEventListener('scroll', () => {
    if (pager.mode !== 'scroll') return;
    // Défilement : on cache les menus en descendant, comme dans une liseuse.
    if (scroller.scrollTop - lastScrollTop > 24 && chromeVisible()) setChrome(false);
    lastScrollTop = scroller.scrollTop;
    onPositionChange();
  }, { passive: true });

  // ---------- Gestes : tap, glisser, luminosité ----------
  let gesture: { id: number; x: number; y: number; t: number; kind: 'pending' | 'swipe' | 'brightness' | 'none'; brightness: number } | null = null;
  let suppressClick = false;

  function hasSelection(): boolean {
    const sel = window.getSelection();
    return !!sel && !sel.isCollapsed;
  }

  scroller.addEventListener('pointerdown', (e) => {
    suppressClick = false;
    if (e.pointerType === 'mouse' || hasSelection() || (e.target as Element).closest('button, a, input, textarea')) {
      gesture = null;
      return;
    }
    gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), kind: 'pending', brightness: settings?.brightness ?? 1 };
  });
  scroller.addEventListener('pointermove', (e) => {
    if (!gesture || e.pointerId !== gesture.id) return;
    const dx = e.clientX - gesture.x;
    const dy = e.clientY - gesture.y;
    if (gesture.kind === 'pending') {
      if (hasSelection()) {
        gesture.kind = 'none';
      } else if (pager.mode === 'paged' && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        gesture.kind = 'swipe';
      } else if (pager.mode === 'paged' && gesture.x < scroller.clientWidth * BRIGHTNESS_EDGE && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        gesture.kind = 'brightness';
      } else if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        gesture.kind = 'none';
      }
    }
    if (gesture.kind === 'swipe') {
      suppressClick = true;
      pager.drag(dx);
    } else if (gesture.kind === 'brightness' && settings) {
      suppressClick = true;
      const value = Math.min(BRIGHTNESS_RANGE.max, Math.max(BRIGHTNESS_RANGE.min, gesture.brightness - dy / (scroller.clientHeight * 0.6)));
      settings = { ...settings, brightness: Math.round(value * 100) / 100 };
      applyReaderSettings(settings);
      brightnessBadge.hidden = false;
      brightnessBadge.textContent = `Luminosité ${Math.round(settings.brightness * 100)} %`;
    }
  });
  const endGesture = (e: PointerEvent) => {
    if (!gesture || e.pointerId !== gesture.id) return;
    const g = gesture;
    gesture = null;
    if (g.kind === 'swipe') {
      const dx = e.clientX - g.x;
      const dir = pager.release(dx, dx / Math.max(1, performance.now() - g.t));
      if (dir !== 0 && chromeVisible()) setChrome(false);
      // Glisser au-delà du bord du chapitre : chapitre voisin.
      if (dir !== 0 && pager.page === (dir === 1 ? pager.pages - 1 : 0) && Math.abs(dx) > scroller.clientWidth * 0.18) {
        const atEdge = dir === 1 ? pager.offset() >= 1 : pager.offset() <= 0;
        if (atEdge) turn(dir);
      }
    } else if (g.kind === 'brightness' && settings) {
      window.setTimeout(() => (brightnessBadge.hidden = true), 700);
      saveReaderSettings(settings).catch((err: unknown) => logError('réglages', err));
    }
  };
  scroller.addEventListener('pointerup', endGesture);
  scroller.addEventListener('pointercancel', (e) => {
    if (gesture?.kind === 'swipe') pager.release(0, 0);
    endGesture(e);
  });

  // Tap : bords = pages, centre = menus. Pas pendant une sélection ni sur un élément interactif.
  scroller.addEventListener('click', (e) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const target = e.target as Element;
    if (e.defaultPrevented || hasSelection() || target.closest('mark.hl, a, button, input, textarea')) return;
    if (chromeVisible()) {
      setChrome(false);
      return;
    }
    const x = (e.clientX - scroller.getBoundingClientRect().left) / scroller.clientWidth;
    if (x < TAP_EDGE) turn(-1);
    else if (x > 1 - TAP_EDGE) turn(1);
    else setChrome(true);
  });

  // Molette (ordinateur) en mode pages.
  let wheelLock = 0;
  scroller.addEventListener('wheel', (e) => {
    if (pager.mode !== 'paged' || Math.abs(e.deltaY) < 8) return;
    e.preventDefault();
    const now = performance.now();
    if (now < wheelLock) return;
    wheelLock = now + 350;
    turn(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  const clockTimer = window.setInterval(updateStatus, 30_000);
  const resize = new ResizeObserver(() => pager.relayout());
  resize.observe(scroller);
  const removeVolume = onVolumeKey((dir) => {
    if (!sheets.some((s) => s.isOpen)) turn(dir);
  });
  void document.fonts?.ready.then(() => pager.relayout());

  const onSelectionChange = () => {
    window.clearTimeout(selectionTimer);
    selectionTimer = window.setTimeout(updateSelectionBar, SELECTION_DELAY_MS);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (sheets.some((s) => s.isOpen) || (e.target as Element).closest?.('input, textarea, select')) return;
    if (e.key === 'Escape') {
      hideMarkMenu();
      setChrome(!chromeVisible());
    } else if ((e.key === 'ArrowLeft' || e.key === 'PageUp') && !e.altKey) {
      e.preventDefault();
      turn(-1);
    } else if ((e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && pager.mode === 'paged')) && !e.altKey) {
      e.preventDefault();
      turn(1);
    }
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
    settings = await loadReaderSettings();
    pager.setMode(settings.layout);
    void applyReaderNative(settings);
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
    onBack() {
      if (!markMenu.hidden || !selectionBar.hidden) {
        hideMarkMenu();
        hideSelectionBar();
        return true;
      }
      return false;
    },
    destroy() {
      void stopListening();
      window.clearInterval(clockTimer);
      resize.disconnect();
      removeVolume();
      void applyReaderNative(null);
      void setImmersive(false);
      if (saveTimer !== undefined) persist();
      window.clearTimeout(selectionTimer);
      cleanup.forEach((fn) => fn());
      sheets.forEach((s) => s.el.remove());
      resourceUrls.forEach((u) => URL.revokeObjectURL(u));
      resourceUrls.clear();
    },
  };
}
