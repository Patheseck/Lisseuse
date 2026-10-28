import { openBook, type OpenedBook } from '../book/service';
import { errorMessage, logError } from '../core/errors';
import { anchorFromOffsets, anchorFromRange, locate, locateLoose, unwrap, wrapRange, type TextAnchor } from '../reader/anchor';
import { htmlToText, type SearchHit } from '../reader/search';
import { deleteCard, demoteCard, listAllCards, listCards, newCard, putCard, type CardRecord } from '../storage/cards';
import { editCard, type CardEditorOptions } from './card-editor';
import { nextFreeNumber } from '../core/mnemonic';
import { getProgress, percentRead, saveProgress, touchBook } from '../storage/library';
import { loadBookmarks, loadFocus, loadGuides, saveBookmarks, saveFocus, saveGuide, type Bookmark, type ChapterGuide } from '../storage/method';
import { newSrs } from '../core/scheduler';
import { applyReaderSettings, loadMojorTable, loadReaderSettings, saveReaderSettings, AUTO_SPEED_RANGE, BRIGHTNESS_RANGE, type ReaderSettings } from '../storage/settings';
import { Pager } from '../reader/pager';
import { applyReaderNative, chapterTick, onVolumeKey, setCustomSelectionMenu, setImmersive } from '../native/reader-native';
import { copyText, shareText } from '../native/files';
import { syncSystemBars } from '../native/system-bars';
import { addRecall, listRecalls, markPretest, pretestDates, type RecallRecord } from '../storage/learning';
import { chapterHeadings, chapterRecall, chapterSurveySheet, pretest } from './chapter-practice';
import { add, clear, h } from './dom';
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
  let guides: Record<string, ChapterGuide> = {};
  let focus: number[] = [];
  let bookmarks: Bookmark[] = [];
  const orphans = new Set<string>();
  const resourceUrls = new Map<string, string>();
  const sheets: Sheet[] = [];
  const cleanup: (() => void)[] = [];

  // ---------- Structure ----------
  const bookTitle = h('span', { className: 'reader-book', 'data-testid': 'reader-title' }, 'Chargement…');
  const chapterTitle = h('span', { className: 'reader-chapter', 'data-testid': 'reader-chapter' });
  const content = h('article', { className: 'reader-content', 'data-testid': 'reader-content', lang: 'fr' });
  const guideBox = h('aside', { className: 'chapter-box guide-box', 'aria-label': 'Avant de lire', 'data-testid': 'guide-box', hidden: true });
  const pretestBox = h('aside', { className: 'chapter-box', 'aria-label': 'Questions avant de relire', 'data-testid': 'pretest-box', hidden: true });
  const chapterEnd = h('aside', { className: 'chapter-box chapter-end', 'aria-label': 'Fin du chapitre', 'data-testid': 'chapter-end', hidden: true });
  const column = h('div', { className: 'reader-column' }, guideBox, pretestBox, content, chapterEnd);
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
  // Question directrice du chapitre, rappelée discrètement en haut pendant la lecture.
  const questionBar = h('div', { className: 'question-bar', 'data-testid': 'question-bar', hidden: true });
  const ribbon = h('div', { className: 'bookmark-ribbon', 'data-testid': 'bookmark-ribbon', 'aria-hidden': 'true', hidden: true });
  const dismissedGuides = new Set<number>();
  const dismissedPretests = new Set<number>();
  const prev = h('button', { type: 'button', className: 'btn', 'data-testid': 'prev-chapter', 'aria-label': 'Chapitre précédent', onclick: () => go(current - 1) }, icon('chevronLeft'), h('span', { className: 'btn-label' }, 'Précédent'));
  const next = h('button', { type: 'button', className: 'btn', 'data-testid': 'next-chapter', 'aria-label': 'Chapitre suivant', onclick: () => go(current + 1) }, h('span', { className: 'btn-label' }, 'Suivant'), icon('chevronRight'));
  const position = h('span', { className: 'muted', 'data-testid': 'chapter-position' });
  const footerMiddle = h('div', { className: 'footer-middle' });
  const footer = h('footer', { className: 'bottombar' }, prev, footerMiddle, next);
  const toolButtons = h('div', { className: 'reader-tools' });
  // Barre de sélection : remplace le menu d'Android (masqué côté natif pendant la lecture).
  const selectionBar = h('div', { className: 'selection-bar', role: 'toolbar', 'aria-label': 'Actions sur la sélection', 'data-testid': 'selection-bar', hidden: true },
    h('div', { className: 'selection-main' },
      h('button', { type: 'button', className: 'btn', 'data-testid': 'highlight-selection', onclick: () => void highlightSelection(false) }, icon('highlight'), 'Surligner'),
      h('button', { type: 'button', className: 'btn btn-primary', 'data-testid': 'card-from-selection', onclick: () => void highlightSelection(true) }, icon('card'), 'Fiche'),
    ),
    h('div', { className: 'selection-more' },
      h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Copier', 'data-testid': 'copy-selection', onclick: () => void copySelection() }, icon('copy')),
      h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Partager', 'data-testid': 'share-selection', onclick: () => void shareSelection() }, icon('share')),
      h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Rechercher dans le livre', 'data-testid': 'search-selection', onclick: () => searchSelection() }, icon('search')),
    ),
  );
  // Sur ordinateur, cliquer un bouton ne doit pas effacer la sélection.
  selectionBar.addEventListener('mousedown', (e) => e.preventDefault());
  /**
   * Dernière sélection valide, mémorisée : sur Android, toucher un bouton efface la sélection
   * avant le clic, l'action s'appuie donc sur cette copie.
   */
  let pendingSelection: { chapter: number; anchor: TextAnchor } | null = null;
  const markMenu = h('div', { className: 'mark-menu', role: 'dialog', 'aria-label': 'Surlignage', hidden: true });
  const autoBar = h('div', { className: 'auto-bar', role: 'toolbar', 'aria-label': 'Défilement automatique', 'data-testid': 'auto-bar', hidden: true });
  footer.hidden = true;
  toolButtons.hidden = true;

  const el = h('div', { className: 'screen reader' },
    h('header', { className: 'topbar reader-chrome' },
      h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Retour à la bibliothèque', 'data-testid': 'back', onclick: () => navigate({ name: 'library' }) }, icon('back')),
      h('div', { className: 'reader-heading' }, bookTitle, chapterTitle),
      toolButtons,
    ),
    scroller,
    questionBar,
    ribbon,
    statusBar,
    autoBar,
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
    const book = percentRead({ chapterCount: opened.chapters.length }, { chapter: current, offset: o }, focus);
    const minutes = Math.round((chapterWords(current) * (1 - o)) / WORDS_PER_MINUTE);
    statusProgress.textContent = `${book} %${o < 1 ? ` · ${minutes < 1 ? '< 1' : minutes} min` : ''}`;
  }

  function onPositionChange(): void {
    hideMarkMenu();
    updateRibbon();
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
    for (const card of cards.filter((c) => c.chapter === current && c.origin !== 'guide')) {
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
    renderGuide(index);
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
    const guide = guides[index];
    const hard = (guide?.gaps ?? []).filter((g) => g.level === 'hard');
    const nextFocus = focus.find((c) => c > index);
    clear(chapterEnd);
    chapterEnd.hidden = false;
    add(chapterEnd,
      h('p', {}, h('strong', {}, 'Fin du chapitre.'), ' Ferme le livre un instant : restitue de mémoire ce que tu viens de lire.'),
      guide?.question ? h('p', { className: 'guide-reminder', 'data-testid': 'end-question' }, 'Ta question : ', h('em', {}, guide.question)) : null,
      previous ? h('p', { className: 'hint' }, `Dernier rappel : ${previous.found} / ${previous.total} idées retrouvées, le ${new Date(previous.at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}.`) : null,
      hard.length
        ? h('div', { className: 'deepen', 'data-testid': 'deepen' },
            h('span', { className: 'field-label' }, 'À approfondir'),
            h('ul', {}, ...hard.map((g) => h('li', {},
              h('span', {}, g.label.length > 120 ? `${g.label.slice(0, 120)}…` : g.label),
              h('button', { type: 'button', className: 'link-btn', onclick: () => showGap(g.label, g.cardId) }, 'Voir le passage'))),
            ))
        : null,
      h('div', { className: 'chapter-box-actions' },
        nextFocus !== undefined && nextFocus > index + 1
          ? h('button', { type: 'button', className: 'btn', 'data-testid': 'next-focus', onclick: () => go(nextFocus) }, 'Prochain chapitre choisi')
          : null,
        h('button', { type: 'button', className: 'btn btn-primary', 'data-testid': 'start-recall', onclick: () => void runRecall(index) }, icon('timer'), 'Restituer le chapitre'),
      ),
    );
  }

  /** Étape « Lire » : proposition d'aperçu en tête de chapitre, et rappel de la question. */
  function renderGuide(index: number): void {
    const guide = guides[index];
    questionBar.textContent = guide?.question ?? '';
    questionBar.hidden = !guide?.question;
    clear(guideBox);
    if (guide?.question) {
      guideBox.hidden = false;
      guideBox.append(
        h('p', { 'data-testid': 'guide-current' }, h('strong', {}, 'Ta question directrice : '), h('em', {}, guide.question)),
        h('div', { className: 'chapter-box-actions' },
          h('button', { type: 'button', className: 'btn', 'data-testid': 'start-survey', onclick: () => void runSurvey(index) }, 'Modifier'),
        ),
      );
      return;
    }
    guideBox.hidden = !(settings?.guided ?? true) || dismissedGuides.has(index);
    if (guideBox.hidden) return;
    guideBox.append(
      h('p', {}, h('strong', {}, 'Avant de lire'), ' : balaye le chapitre (≈ 1 min) et pose-toi une question. Ton cerveau passe en mode recherche.'),
      h('div', { className: 'chapter-box-actions' },
        h('button', { type: 'button', className: 'btn', 'data-testid': 'skip-survey', onclick: () => { dismissedGuides.add(index); renderGuide(index); pager.relayout(); } }, 'Plus tard'),
        h('button', { type: 'button', className: 'btn btn-primary', 'data-testid': 'start-survey', onclick: () => void runSurvey(index) }, icon('compass'), 'Aperçu du chapitre'),
      ),
    );
  }

  async function runSurvey(index: number): Promise<void> {
    const all = await listAllCards().catch(() => cards);
    const question = await chapterSurveySheet({
      chapterLabel: opened?.chapters[index]?.label ?? `Chapitre ${index + 1}`,
      html: opened?.chapters[index]?.html ?? '',
      question: guides[index]?.question ?? '',
      otherQuestions: [...all.filter((c) => c.kind !== 'highlight').map((c) => c.question), ...Object.entries(guides).filter(([k]) => Number(k) !== index).map(([, g]) => g.question)],
    });
    if (question === null) return;
    const guide: ChapterGuide = { ...guides[index], question, questionAt: Date.now() };
    try {
      await saveGuide(bookId, index, guide);
      guides[index] = guide;
      if (index === current) {
        renderGuide(index);
        void renderChapterExtras(index);
        requestAnimationFrame(() => pager.relayout());
      }
      setChrome(false);
    } catch (err) {
      logError('question directrice', err);
      toast(`Question non enregistrée : ${errorMessage(err)}`, 'error');
    }
  }

  /** Amène à l'écran un point « mal compris » (passage surligné ou intertitre). */
  function showGap(label: string, cardId?: string): void {
    const card = cardId ? cards.find((c) => c.id === cardId) : undefined;
    const text = content.textContent ?? '';
    const found = card ? locate(text, card.anchor) : locateLoose(text, label);
    if (found) flash(found.start, found.end);
    else toast('Ce passage n’a pas été retrouvé dans le texte.');
  }

  async function runPretest(index: number): Promise<void> {
    const questions = chapterCards(index).filter((c) => c.kind !== 'highlight').sort(() => Math.random() - 0.5).slice(0, PRETEST_MAX);
    const completed = await pretest(questions);
    dismissedPretests.add(index);
    pretestBox.hidden = true;
    if (completed) await markPretest(bookId, index).catch((err: unknown) => logError('pré-questions', err));
  }

  /** Fiche « question directrice → idée principale », ancrée au début du chapitre (sans surlignage). */
  function guideCard(index: number, guide: ChapterGuide, main: string): CardRecord {
    const existing = guide.cardId ? cards.find((c) => c.id === guide.cardId) : undefined;
    if (existing) return { ...existing, question: guide.question, answer: main, updatedAt: Date.now() };
    const text = chapterTexts()[index] ?? '';
    const lead = text.trimStart();
    const start = text.length - lead.length;
    const end = Math.min(text.length, start + Math.max(1, Math.min(160, lead.length)));
    return { ...newCard(bookId, index, anchorFromOffsets(text, start, end)), kind: 'qa', question: guide.question, answer: main, srs: newSrs(), origin: 'guide' };
  }

  async function runRecall(index: number): Promise<void> {
    const before = guides[index];
    const result = await chapterRecall({
      chapterLabel: opened?.chapters[index]?.label ?? `Chapitre ${index + 1}`,
      question: before?.question ?? '',
      hasGuideCard: !!before?.cardId && cards.some((c) => c.id === before.cardId),
      passages: chapterCards(index),
      headings: chapterHeadings(opened?.chapters[index]?.html ?? ''),
    });
    if (!result) return;
    try {
      let guide: ChapterGuide = {
        ...(before ?? { question: '', questionAt: 0 }),
        answered: result.answered, main: result.main, args: result.text, explain: result.explain,
        restitutedAt: Date.now(), gaps: result.gaps,
      };
      if (result.makeGuideCard && guide.question && result.main) {
        const card = guideCard(index, guide, result.main);
        await putCard(card);
        cards = [...cards.filter((c) => c.id !== card.id), card];
        sortCards();
        guide = { ...guide, cardId: card.id };
      }
      // Fiches existantes jugées « mal comprises » : elles remontent en tête des révisions.
      const now = Date.now();
      for (const gap of result.gaps.filter((g) => g.level === 'hard' && g.cardId)) {
        const card = cards.find((c) => c.id === gap.cardId);
        if (card?.srs && card.srs.due > now) {
          const updated = { ...card, srs: { ...card.srs, due: now }, updatedAt: now };
          await putCard(updated);
          cards = cards.map((c) => (c.id === updated.id ? updated : c));
        }
      }
      await saveGuide(bookId, index, guide);
      guides[index] = guide;
      await addRecall(bookId, { chapter: index, at: Date.now(), text: [result.main, result.text, result.explain].filter(Boolean).join('\n\n'), found: result.found, total: result.total });
      const hardCount = result.gaps.filter((g) => g.level === 'hard').length;
      toast([
        result.total ? `Rappel enregistré : ${result.found} / ${result.total} idées retrouvées.` : 'Rappel enregistré.',
        hardCount ? `${hardCount} point${hardCount > 1 ? 's' : ''} à approfondir.` : '',
      ].filter(Boolean).join(' '));
      if (index === current) void renderChapterExtras(index);
      toc.refresh();
      // Étape « Récupérer » : les passages qui ont résisté deviennent des fiches.
      for (const card of result.cardsToCreate) {
        const fresh = cards.find((c) => c.id === card.id);
        if (fresh?.kind === 'highlight') await openEditor(fresh);
      }
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
    pendingSelection = null;
  }

  function updateSelectionBar(): void {
    const range = currentSelectionRange();
    const anchor = range && range.toString().trim() ? anchorFromRange(content, range) : null;
    if (!range || !anchor) {
      hideSelectionBar();
      return;
    }
    pendingSelection = { chapter: current, anchor };
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
    const first = rects[0] ?? range.getBoundingClientRect();
    const last = rects.at(-1) ?? first;
    selectionBar.hidden = false;
    const barH = selectionBar.offsetHeight;
    const barW = selectionBar.offsetWidth;
    // Au-dessus de la sélection s'il y a la place, sinon en dessous en laissant de la place
    // aux poignées de sélection (environ 2,5 rem sous la dernière ligne).
    const above = first.top - barH - 14;
    const top = above >= 12 ? above : Math.min(window.innerHeight - barH - 12, last.bottom + 40);
    const anchorX = above >= 12 ? first.left + first.width / 2 : last.left + last.width / 2;
    selectionBar.style.top = `${Math.max(12, top)}px`;
    selectionBar.style.left = `${Math.min(window.innerWidth - barW - 8, Math.max(8, anchorX - barW / 2))}px`;
  }

  /** Texte de la sélection en cours (mots complets), ou null. */
  function takeSelection(): { chapter: number; anchor: TextAnchor } | null {
    const range = currentSelectionRange();
    const live = range ? anchorFromRange(content, range) : null;
    const taken = live ? { chapter: current, anchor: live } : pendingSelection;
    hideSelectionBar();
    window.getSelection()?.removeAllRanges();
    return taken && taken.chapter === current ? taken : null;
  }

  async function copySelection(): Promise<void> {
    const taken = takeSelection();
    if (!taken) return;
    try {
      await copyText(taken.anchor.quote);
      toast('Passage copié.');
    } catch (err) {
      logError('copie', err);
      toast('Copie impossible sur cet appareil.', 'error');
    }
  }

  async function shareSelection(): Promise<void> {
    const taken = takeSelection();
    if (!taken || !opened) return;
    const text = `« ${taken.anchor.quote} »\n— ${opened.book.title}${opened.book.author ? `, ${opened.book.author}` : ''}`;
    try {
      await shareText(text);
    } catch (err) {
      logError('partage', err);
      toast('Partage impossible sur cet appareil.', 'error');
    }
  }

  function searchSelection(): void {
    const taken = takeSelection();
    if (taken) search.searchFor(taken.anchor.quote.slice(0, 80));
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
    // Les marques existantes ne changent pas le texte : les positions restent exactes.
    const anchor = takeSelection()?.anchor;
    if (!anchor) return;
    const overlapping = cards.find((c) => c.chapter === current && c.origin !== 'guide' && !orphans.has(c.id) && c.anchor.start < anchor.end && anchor.start < c.anchor.end);
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
    depth: (i) => opened?.chapters[i]?.depth ?? 0,
    current: () => current,
    cards: () => cards,
    orphans: () => orphans,
    onChapter: (i) => go(i),
    onCard: (card) => {
      // Fiche de question directrice : elle concerne tout le chapitre, on l'ouvre à son début.
      if (card.origin === 'guide') {
        go(card.chapter);
        return;
      }
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
    focus: () => focus,
    onToggleFocus: (i) => {
      focus = focus.includes(i) ? focus.filter((c) => c !== i) : [...focus, i].sort((a, b) => a - b);
      void persistFocus();
    },
    onClearFocus: () => {
      focus = [];
      void persistFocus();
    },
    bookmarks: () => bookmarks,
    onBookmark: (b) => go(b.chapter, { offset: b.offset }),
    onDeleteBookmark: (b) => {
      bookmarks = bookmarks.filter((x) => x.id !== b.id);
      void persistBookmarks();
      toc.refresh();
    },
  });

  async function persistFocus(): Promise<void> {
    try {
      await saveFocus(bookId, focus);
      updateStatus();
      void renderChapterExtras(current);
    } catch (err) {
      logError('objectif', err);
      toast(`Choix non enregistré : ${errorMessage(err)}`, 'error');
    }
  }

  // ---------- Signets ----------
  function bookmarkHere(): Bookmark | undefined {
    const o = offset();
    return bookmarks.find((b) => {
      if (b.chapter !== current) return false;
      if (pager.mode === 'paged') return pager.pages <= 1 || Math.round(b.offset * (pager.pages - 1)) === pager.page;
      const max = scroller.scrollHeight - scroller.clientHeight;
      return max <= 0 || Math.abs(b.offset - o) * max < scroller.clientHeight / 2;
    });
  }

  function updateRibbon(): void {
    const here = !!opened && !!bookmarkHere();
    ribbon.hidden = !here;
    bookmarkButton.setAttribute('aria-pressed', String(here));
    bookmarkButton.setAttribute('aria-label', here ? 'Retirer le signet de cette page' : 'Ajouter un signet sur cette page');
  }

  async function persistBookmarks(): Promise<void> {
    try {
      await saveBookmarks(bookId, bookmarks);
    } catch (err) {
      logError('signet', err);
      toast(`Signet non enregistré : ${errorMessage(err)}`, 'error');
    }
    updateRibbon();
  }

  function toggleBookmark(): void {
    const here = bookmarkHere();
    if (here) {
      bookmarks = bookmarks.filter((b) => b.id !== here.id);
      toast('Signet retiré.');
    } else {
      const blocks = readableBlocks();
      const first = blocks[pager.firstVisible(blocks)]?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      bookmarks = [...bookmarks, { id: crypto.randomUUID(), chapter: current, offset: offset(), label: first.length > 90 ? `${first.slice(0, 90)}…` : first, at: Date.now() }]
        .sort((a, b) => a.chapter - b.chapter || a.offset - b.offset);
      toast('Signet ajouté.');
    }
    void persistBookmarks();
  }
  const bookmarkButton = h('button', { type: 'button', className: 'icon-btn', 'aria-pressed': 'false', 'aria-label': 'Ajouter un signet sur cette page', 'data-testid': 'toggle-bookmark', onclick: () => toggleBookmark() }, icon('bookmark'));

  // ---------- Défilement automatique ----------
  let auto: { paused: boolean; timer?: number; frame?: number; last?: number; acc: number } | null = null;
  const autoSpeed = h('output', { className: 'auto-speed', 'data-testid': 'auto-speed' });
  const autoPause = h('button', { type: 'button', className: 'icon-btn', 'data-testid': 'auto-pause', 'aria-label': 'Pause', onclick: () => (auto?.paused ? resumeAuto() : pauseAuto()) }, icon('pause'));
  /** Pages : secondes par page ; défilement : pixels par seconde. */
  const pageSeconds = (speed: number) => Math.round(70 / (speed + 1.5));
  const pixelsPerSecond = (speed: number) => 12 + speed * 9;

  function speedOf(): number {
    return settings?.autoSpeed ?? 4;
  }

  function changeSpeed(delta: number): void {
    if (!settings) return;
    const speed = Math.min(AUTO_SPEED_RANGE.max, Math.max(AUTO_SPEED_RANGE.min, settings.autoSpeed + delta));
    settings = { ...settings, autoSpeed: speed };
    saveReaderSettings(settings).catch((err: unknown) => logError('réglages', err));
    refreshAutoBar();
    if (auto && !auto.paused) {
      stopTimers();
      runAuto();
    }
  }

  function refreshAutoBar(): void {
    autoBar.hidden = !auto;
    autoSpeed.textContent = pager.mode === 'paged' ? `Vitesse ${speedOf()} · ${pageSeconds(speedOf())} s/page` : `Vitesse ${speedOf()}`;
    autoPause.replaceChildren(icon(auto?.paused ? 'play' : 'pause'));
    autoPause.setAttribute('aria-label', auto?.paused ? 'Reprendre' : 'Pause');
    autoButton.setAttribute('aria-pressed', String(!!auto));
  }

  function stopTimers(): void {
    if (!auto) return;
    window.clearInterval(auto.timer);
    if (auto.frame !== undefined) cancelAnimationFrame(auto.frame);
    auto.timer = undefined;
    auto.frame = undefined;
    auto.last = undefined;
  }

  function atBookEnd(): boolean {
    return !!opened && current >= opened.chapters.length - 1 && offset() >= 1;
  }

  function runAuto(): void {
    if (!auto) return;
    if (pager.mode === 'paged') {
      auto.timer = window.setInterval(() => {
        if (atBookEnd()) return stopAuto();
        turn(1);
      }, pageSeconds(speedOf()) * 1000);
      return;
    }
    const step = (t: number) => {
      if (!auto || auto.paused) return;
      const dt = auto.last === undefined ? 0 : Math.min(100, t - auto.last);
      auto.last = t;
      auto.acc += (pixelsPerSecond(speedOf()) * dt) / 1000;
      const max = scroller.scrollHeight - scroller.clientHeight;
      if (scroller.scrollTop >= max - 1) {
        if (atBookEnd() || !opened) return stopAuto();
        auto.acc = 0;
        go(current + 1);
      } else if (auto.acc >= 1) {
        const whole = Math.floor(auto.acc);
        auto.acc -= whole;
        scroller.scrollTop += whole;
      }
      auto.frame = requestAnimationFrame(step);
    };
    auto.frame = requestAnimationFrame(step);
  }

  function startAuto(): void {
    if (auto) return stopAuto();
    auto = { paused: false, acc: 0 };
    setChrome(false);
    refreshAutoBar();
    runAuto();
  }

  function pauseAuto(): void {
    if (!auto || auto.paused) return;
    stopTimers();
    auto.paused = true;
    refreshAutoBar();
  }

  function resumeAuto(): void {
    if (!auto || !auto.paused) return;
    auto.paused = false;
    refreshAutoBar();
    runAuto();
  }

  function stopAuto(): void {
    stopTimers();
    auto = null;
    refreshAutoBar();
  }
  const autoButton = h('button', { type: 'button', className: 'icon-btn', 'aria-pressed': 'false', 'aria-label': 'Défilement automatique', 'data-testid': 'auto-scroll', onclick: () => startAuto() }, icon('play'));
  autoBar.append(
    h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Plus lent', 'data-testid': 'auto-slower', onclick: () => changeSpeed(-1) }, icon('minus')),
    autoSpeed,
    h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Plus rapide', 'data-testid': 'auto-faster', onclick: () => changeSpeed(1) }, icon('plus')),
    autoPause,
    h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Arrêter le défilement automatique', 'data-testid': 'auto-stop', onclick: () => stopAuto() }, icon('stop')),
  );
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
      await speak(queue.map((b) => b.textContent ?? ''), opened?.book.language, (i) => {
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
    if (layoutChanged) {
      pager.setMode(next.layout);
      if (auto) stopAuto();
    } else {
      requestAnimationFrame(() => pager.relayout());
    }
    renderGuide(current);
    void syncSystemBars();
    void applyReaderNative(next);
    updateStatus();
  }

  footerMiddle.append(autoButton, position, listenButton);
  toolButtons.append(
    h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Rechercher dans le livre', 'data-testid': 'open-search', onclick: () => search.open() }, icon('search')),
    h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Sommaire, surlignages et signets', 'data-testid': 'open-toc', onclick: () => toc.open() }, icon('toc')),
    bookmarkButton,
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
    // Un tap qui sert à annuler une sélection ne tourne pas la page et n'ouvre pas les menus.
    suppressClick = hasSelection() || !selectionBar.hidden;
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
      if (!hasSelection()) hideSelectionBar();
      return;
    }
    const target = e.target as Element;
    if (e.defaultPrevented || hasSelection() || target.closest('mark.hl, a, button, input, textarea')) return;
    if (auto) {
      // Pendant le défilement automatique, un tap met en pause ou relance.
      if (auto.paused) resumeAuto();
      else pauseAuto();
      return;
    }
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
    if (auto) pauseAuto();
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
  // Menu de sélection natif : masqué sur le texte du livre, rétabli dans les champs de saisie.
  const editable = (t: EventTarget | null) => !!(t as Element | null)?.closest?.('input, textarea, [contenteditable]');
  const onFocusIn = (e: FocusEvent) => void setCustomSelectionMenu(!editable(e.target));
  const onFocusOut = () => void setCustomSelectionMenu(true);
  void setCustomSelectionMenu(true);
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', onFocusOut);
  cleanup.push(
    () => document.removeEventListener('focusin', onFocusIn),
    () => document.removeEventListener('focusout', onFocusOut),
    () => void setCustomSelectionMenu(false),
  );
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
    [guides, focus, bookmarks] = await Promise.all([
      loadGuides(bookId).catch(() => ({})),
      loadFocus(bookId, opened.chapters.length).catch(() => []),
      loadBookmarks(bookId).catch(() => []),
    ]);
    settings = await loadReaderSettings();
    pager.setMode(settings.layout);
    void applyReaderNative(settings);
    bookTitle.textContent = opened.book.title;
    // Langue du livre : césure des mots et prononciation de la lecture à voix haute.
    content.lang = opened.book.language || 'fr';
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
      stopAuto();
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
