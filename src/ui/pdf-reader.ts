import type { PDFViewer } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs';
import { ImportCancelled } from '../book/errors';
import { loadPdfViewer, openPdf, readOutline, type OpenedPdf } from '../book/pdf';
import type { PdfOutlineEntry } from '../book/pdf-text';
import { errorMessage, logError } from '../core/errors';
import { ambiancePlayer } from '../audio/player';
import { applyReaderNative, onVolumeKey, setCustomSelectionMenu, setImmersive } from '../native/reader-native';
import { getBookAmbiance, loadAmbiancePrefs } from '../storage/audio';
import { getBook, getProgress, savePageProgress, saveJump, touchBook, updateBook, type BookRecord } from '../storage/library';
import { loadPageMarks, loadPdfPrefs, savePageMarks, savePdfPrefs, type PdfViewPrefs } from '../storage/method';
import { applyReaderSettings, BRIGHTNESS_RANGE, loadReaderSettings, saveReaderSettings, type ReaderSettings, type Theme } from '../storage/settings';
import { isNative } from '../native/platform';
import { ambianceSheet } from './ambiance-sheet';
import { add, h } from './dom';
import { toast } from './feedback';
import { icon } from './icons';
import { pdfOptions } from './import-flow';
import { segmented, THEMES, toggle } from './reader-settings';
import type { Navigate, Screen } from './screen';
import { createSheet, type Sheet } from './sheet';

// Lecteur de PDF en pages originales, comme dans les autres liseuses : la visionneuse de pdf.js
// affiche les pages telles qu'imprimées (texte sélectionnable, liens, recherche surlignée).
// Le « texte adapté » (PDF converti en livre) reste à un geste, pour les fiches et la méthode.

const SAVE_DELAY_MS = 500;
const TAP_EDGE = 0.3;
const DOUBLE_TAP_MS = 280;
const PAGE_FIT = 'page-fit';
const PAGE_WIDTH = 'page-width';

/** Couleur CSS « #rrggbb » ou « rgb(…) » → luminance (0 noir, 1 blanc), null si illisible. */
export function luminance(color: string): number | null {
  const c = color.trim();
  let rgb: number[] | null = null;
  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const v = hex[1]!.length === 3 ? hex[1]!.split('').map((x) => x + x).join('') : hex[1]!;
    rgb = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
  } else {
    const m = c.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
    if (m) rgb = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => v / 255) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Couleurs des pages selon le thème : sur un thème sombre ou sépia, le texte et le fond de la page
 * prennent les couleurs du thème (les images gardent les leurs). Thème clair : couleurs d'origine.
 */
export function themePageColors(prefs: Pick<PdfViewPrefs, 'colors'>): { background: string; foreground: string } | null {
  if (prefs.colors === 'original') return null;
  const css = getComputedStyle(document.documentElement);
  const background = css.getPropertyValue('--bg').trim();
  const foreground = css.getPropertyValue('--ink').trim();
  const lum = luminance(background);
  if (!background || !foreground || lum === null || lum > 0.93) return null;
  return { background, foreground };
}

export function pdfReaderScreen(bookId: string, navigate: Navigate): Screen {
  let book: BookRecord | null = null;
  let opened: OpenedPdf | null = null;
  let viewer: PDFViewer | null = null;
  let lib: Awaited<ReturnType<typeof loadPdfViewer>> | null = null;
  let eventBus: InstanceType<Awaited<ReturnType<typeof loadPdfViewer>>['viewer']['EventBus']> | null = null;
  let viewerAbort: AbortController | null = null;
  let settings: ReaderSettings | null = null;
  let prefs: PdfViewPrefs = { scroll: 'vertical', colors: 'theme' };
  let marks: number[] = [];
  let outline: PdfOutlineEntry[] | null = null;
  let destroyed = false;
  let saveTimer: number | undefined;
  let restored = false;
  const cleanup: (() => void)[] = [];
  const sheets: Sheet[] = [];

  // ---------- Structure ----------
  const bookTitle = h('span', { className: 'reader-book', 'data-testid': 'reader-title' }, 'Chargement…');
  const pageTitle = h('span', { className: 'reader-chapter', 'data-testid': 'pdf-page' });
  const viewerEl = h('div', { className: 'pdfViewer' });
  const scroller = h('div', { className: 'pdf-scroll', 'data-testid': 'pdf-viewer', tabindex: '-1' }, viewerEl);
  const message = h('p', { className: 'pdf-message', 'data-testid': 'pdf-message', hidden: true });
  const statusPage = h('span', { 'data-testid': 'status-page' });
  const statusClock = h('span', { 'data-testid': 'status-clock' });
  const statusProgress = h('span', { 'data-testid': 'status-progress' });
  const statusBar = h('div', { className: 'status-bar', 'aria-hidden': 'true' }, statusPage, statusClock, statusProgress);
  const dim = h('div', { className: 'dim-layer', 'aria-hidden': 'true' });
  const bookmarkButton = h('button', { type: 'button', className: 'icon-btn', 'aria-pressed': 'false', 'aria-label': 'Ajouter un signet sur cette page', 'data-testid': 'toggle-bookmark', onclick: () => void toggleMark() }, icon('bookmark'));
  const toolButtons = h('div', { className: 'reader-tools', hidden: true },
    h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Rechercher dans le PDF', 'data-testid': 'open-search', onclick: () => openFind() }, icon('search')),
    h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Sommaire et signets', 'data-testid': 'open-toc', onclick: () => void openToc() }, icon('toc')),
    bookmarkButton,
    h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Affichage du PDF', 'data-testid': 'open-settings', onclick: () => openSettings() }, icon('text')),
  );
  const pageButton = h('button', { type: 'button', className: 'btn pdf-page-button', 'data-testid': 'pdf-go-page', 'aria-label': 'Aller à la page', onclick: () => openGoTo() });
  const ambiance = ambiancePlayer();
  const ambianceButton = h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Ambiance musicale', 'aria-pressed': 'false', 'data-testid': 'open-ambiance', 'data-state': 'stopped', onclick: () => openAmbiance() }, icon('music'));
  const prev = h('button', { type: 'button', className: 'btn', 'data-testid': 'prev-page', 'aria-label': 'Page précédente', onclick: () => turn(-1) }, icon('chevronLeft'));
  const next = h('button', { type: 'button', className: 'btn', 'data-testid': 'next-page', 'aria-label': 'Page suivante', onclick: () => turn(1) }, icon('chevronRight'));
  const footer = h('footer', { className: 'bottombar reader-chrome', hidden: true }, prev, h('div', { className: 'footer-middle' }, pageButton, ambianceButton), next);

  // Recherche dans le PDF (résultats surlignés sur les pages).
  const findInput = h('input', { type: 'text', className: 'input', placeholder: 'Rechercher dans le PDF', 'aria-label': 'Rechercher dans le PDF', 'data-testid': 'pdf-find-input', enterkeyhint: 'search' });
  const findCount = h('span', { className: 'pdf-find-count', 'data-testid': 'pdf-find-count', 'aria-live': 'polite' });
  const findBar = h('div', { className: 'pdf-find', role: 'search', 'data-testid': 'pdf-find', hidden: true },
    findInput, findCount,
    h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Résultat précédent', 'data-testid': 'pdf-find-prev', onclick: () => find(true) }, icon('chevronLeft')),
    h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Résultat suivant', 'data-testid': 'pdf-find-next', onclick: () => find(false) }, icon('chevronRight')),
    h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Fermer la recherche', 'data-testid': 'pdf-find-close', onclick: () => closeFind() }, icon('close')),
  );

  const el = h('div', { className: 'screen reader pdf-reader' },
    h('header', { className: 'topbar reader-chrome' },
      h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Retour à la bibliothèque', 'data-testid': 'back', onclick: () => navigate({ name: 'library' }) }, icon('back')),
      h('div', { className: 'reader-heading' }, bookTitle, pageTitle),
      toolButtons,
    ),
    scroller,
    message,
    findBar,
    statusBar,
    footer,
    dim,
  );

  // ---------- Pages ----------
  const pageCount = () => viewer?.pagesCount ?? book?.pageCount ?? 0;

  /** Page affichée (depuis 0) et position dans la page (0 à 1, défilement vertical). */
  function position(): { page: number; offset: number } {
    if (!viewer) return { page: 0, offset: 0 };
    const page = Math.max(0, viewer.currentPageNumber - 1);
    // Tout en bas du document : la dernière page est lue jusqu'au bout.
    const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2 && scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 2;
    if (atEnd && page >= pageCount() - 1) return { page, offset: 1 };
    const div = viewer.getPageView(page)?.div;
    if (!div || prefs.scroll === 'pages' || !div.offsetHeight) return { page, offset: 0 };
    return { page, offset: Math.min(1, Math.max(0, (scroller.scrollTop - div.offsetTop) / div.offsetHeight)) };
  }

  function updateStatus(): void {
    const total = pageCount();
    if (!viewer || !total) return;
    const { page, offset } = position();
    const label = `Page ${page + 1} sur ${total}`;
    pageTitle.textContent = label;
    pageButton.textContent = `${page + 1} / ${total}`;
    statusPage.textContent = `${page + 1} / ${total}`;
    statusClock.textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    statusProgress.textContent = `${Math.round(Math.min(100, ((page + offset) / total) * 100))} %`;
    prev.disabled = page === 0 && offset <= 0;
    next.disabled = page >= total - 1;
    const marked = marks.includes(page);
    bookmarkButton.setAttribute('aria-pressed', String(marked));
    bookmarkButton.setAttribute('aria-label', marked ? 'Retirer le signet de cette page' : 'Ajouter un signet sur cette page');
  }

  function persist(): void {
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
    if (!viewer || !restored) return;
    const { page, offset } = position();
    savePageProgress(bookId, page, offset).catch((err: unknown) => logError('progression', err));
  }

  function onMove(): void {
    updateStatus();
    if (saveTimer === undefined) saveTimer = window.setTimeout(persist, SAVE_DELAY_MS);
  }

  function setChrome(visible: boolean): void {
    el.classList.toggle('chrome-hidden', !visible);
    void setImmersive(!visible);
  }
  const chromeVisible = () => !el.classList.contains('chrome-hidden');

  /** Page suivante ou précédente ; en défilement continu, un écran plus loin (avec un peu de recouvrement). */
  function turn(dir: 1 | -1): void {
    if (!viewer) return;
    if (chromeVisible()) setChrome(false);
    if (prefs.scroll === 'pages') {
      if (dir === 1) viewer.nextPage();
      else viewer.previousPage();
      return;
    }
    scroller.scrollBy({ top: dir * Math.max(80, scroller.clientHeight - 64), behavior: 'auto' });
  }

  function goToPage(page: number, offset = 0): void {
    if (!viewer) return;
    const n = Math.min(pageCount(), Math.max(1, page + 1));
    viewer.scrollPageIntoView({ pageNumber: n });
    if (offset > 0 && prefs.scroll === 'vertical') {
      const div = viewer.getPageView(n - 1)?.div;
      if (div) scroller.scrollTop = div.offsetTop + offset * div.offsetHeight;
    }
    onMove();
  }

  /** Zoom « tenir dans l'écran » : largeur en défilement continu, page entière en page par page. */
  const fitScale = () => (prefs.scroll === 'pages' ? PAGE_FIT : PAGE_WIDTH);
  const isFitted = () => viewer?.currentScaleValue === fitScale();

  function applyLayout(): void {
    if (!viewer || !lib) return;
    const { ScrollMode } = lib.viewer;
    viewer.scrollMode = prefs.scroll === 'pages' ? ScrollMode.HORIZONTAL : ScrollMode.VERTICAL;
    viewer.currentScaleValue = fitScale();
    refreshSnap();
  }

  /** Page par page : l'aimantation des pages, sauf zoomé (on doit pouvoir se déplacer dans la page). */
  function refreshSnap(): void {
    scroller.classList.toggle('pdf-snap', prefs.scroll === 'pages' && isFitted());
  }

  function zoom(factor: number, origin?: [number, number]): void {
    if (!viewer) return;
    if (factor === 0) viewer.currentScaleValue = fitScale();
    else viewer.updateScale({ scaleFactor: factor, drawingDelay: 300, ...(origin ? { origin } : {}) });
    refreshSnap();
  }

  /** (Re)construit la visionneuse : à l'ouverture, et quand les couleurs des pages changent. */
  function buildViewer(at?: { page: number; offset: number }): void {
    if (!opened || !lib || destroyed) return;
    const { PDFViewer, EventBus, PDFLinkService, PDFFindController, LinkTarget } = lib.viewer;
    viewer?.setDocument(null as never);
    viewerAbort?.abort();
    viewerAbort = new AbortController();
    viewerEl.replaceChildren();
    viewerEl.className = 'pdfViewer';
    const bus = new EventBus();
    eventBus = bus;
    const linkService = new PDFLinkService({ eventBus: bus, externalLinkTarget: LinkTarget.BLANK, externalLinkRel: 'noopener noreferrer nofollow' });
    const findController = new PDFFindController({ eventBus: bus, linkService });
    const options = {
      container: scroller,
      viewer: viewerEl,
      eventBus: bus,
      linkService,
      findController,
      textLayerMode: 1,
      annotationMode: lib.pdfjs.AnnotationMode.ENABLE,
      removePageBorders: true,
      pageColors: themePageColors(prefs) ?? undefined,
      // (Lu par la visionneuse, absent de ses types) : ses écouteurs s'arrêtent avec elle.
      abortSignal: viewerAbort.signal,
    };
    const v = new PDFViewer(options as ConstructorParameters<typeof PDFViewer>[0]);
    viewer = v;
    linkService.setViewer(v);
    bus.on('pagesinit', () => {
      if (viewer !== v) return;
      applyLayout();
      if (at) goToPage(at.page, at.offset);
      restored = true;
      updateStatus();
    });
    bus.on('pagechanging', () => onMove());
    bus.on('scalechanging', () => refreshSnap());
    bus.on('updatefindmatchescount', ({ matchesCount }: { matchesCount: { current: number; total: number } }) => showCount(matchesCount));
    bus.on('updatefindcontrolstate', ({ state, matchesCount }: { state: number; matchesCount: { current: number; total: number } }) => {
      if (state === 1) findCount.textContent = 'Introuvable';
      else if (matchesCount) showCount(matchesCount);
    });
    v.setDocument(opened.doc);
    linkService.setDocument(opened.doc, null);
  }

  // ---------- Recherche ----------
  let findTimer: number | undefined;
  function showCount(c: { current: number; total: number }): void {
    findCount.textContent = c.total ? `${c.current} / ${c.total}` : findInput.value.trim() ? 'Introuvable' : '';
  }
  function find(previous: boolean, again = true): void {
    const query = findInput.value.trim();
    if (!eventBus || !query) return;
    eventBus.dispatch('find', { source: null, type: again ? 'again' : '', query, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: previous, matchDiacritics: false });
  }
  findInput.addEventListener('input', () => {
    window.clearTimeout(findTimer);
    findTimer = window.setTimeout(() => (findInput.value.trim() ? find(false, false) : (findCount.textContent = '')), 300);
  });
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      find(e.shiftKey);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeFind();
    }
  });
  function openFind(): void {
    findBar.hidden = false;
    findInput.focus();
    findInput.select();
  }
  function closeFind(): void {
    findBar.hidden = true;
    findCount.textContent = '';
    eventBus?.dispatch('findbarclose', { source: null });
  }

  // ---------- Sommaire et signets ----------
  async function toggleMark(): Promise<void> {
    if (!viewer) return;
    const { page } = position();
    const had = marks.includes(page);
    marks = had ? marks.filter((p) => p !== page) : [...marks, page].sort((a, b) => a - b);
    updateStatus();
    try {
      await savePageMarks(bookId, marks);
      toast(had ? 'Signet retiré.' : `Signet ajouté : page ${page + 1}.`);
    } catch (err) {
      logError('signets', err);
      toast(`Signet non enregistré : ${errorMessage(err)}`, 'error');
    }
  }

  let tocSheet: Sheet | null = null;
  let tocTab: 'outline' | 'marks' = 'outline';
  async function openToc(): Promise<void> {
    if (!opened) return;
    outline ??= await readOutline(opened.doc).catch(() => []);
    if (!tocSheet) {
      tocSheet = createSheet({ title: 'Sommaire', kind: 'side', testId: 'toc-sheet' });
      sheets.push(tocSheet);
    }
    renderToc();
    tocSheet.open();
  }
  function renderToc(): void {
    if (!tocSheet) return;
    const sheet = tocSheet;
    const tab = (id: typeof tocTab, label: string) => h('button', { type: 'button', role: 'tab', className: 'tab', 'aria-selected': String(tocTab === id), onclick: () => { tocTab = id; renderToc(); } }, label);
    const panel = h('div', { className: 'toc-panel', role: 'tabpanel' });
    if (tocTab === 'outline') {
      const entries = (outline ?? []).filter((e) => e.page >= 0);
      if (!entries.length) panel.append(h('p', { className: 'muted toc-empty', 'data-testid': 'toc-empty' }, 'Ce PDF n’a pas de sommaire. Touche le numéro de page, en bas, pour aller à une page précise.'));
      else {
        panel.append(h('ol', { className: 'toc-list pdf-outline' }, ...entries.map((e) => h('li', { className: 'toc-row' },
          h('button', {
            type: 'button', className: `toc-item toc-depth-${Math.min(3, e.level)}`, 'data-testid': 'pdf-outline-item',
            onclick: () => {
              sheet.close();
              viewer?.scrollPageIntoView({ pageNumber: e.page + 1, ...(e.y !== null ? { destArray: [null, { name: 'XYZ' }, null, e.y, null] } : {}) });
              onMove();
            },
          }, e.title),
          h('span', { className: 'pdf-outline-page' }, `p. ${e.page + 1}`),
        ))));
      }
    } else if (!marks.length) {
      panel.append(h('p', { className: 'muted toc-empty' }, 'Aucun signet. Touche l’icône signet, en haut, pour marquer la page affichée.'));
    } else {
      panel.append(h('ul', { className: 'hl-list' }, ...marks.map((p) => h('li', { className: 'hl-item', 'data-testid': 'bookmark-item' },
        h('button', { type: 'button', className: 'hl-open', onclick: () => { sheet.close(); goToPage(p); } }, h('span', { className: 'hl-chapter' }, `Page ${p + 1}`)),
        h('button', {
          type: 'button', className: 'icon-btn', 'aria-label': `Supprimer le signet de la page ${p + 1}`, 'data-testid': 'bookmark-delete',
          onclick: () => {
            marks = marks.filter((x) => x !== p);
            void savePageMarks(bookId, marks).catch((err: unknown) => logError('signets', err));
            updateStatus();
            renderToc();
          },
        }, icon('trash')),
      ))));
    }
    sheet.body.replaceChildren(h('div', { className: 'tabs', role: 'tablist' }, tab('outline', 'Sommaire'), tab('marks', `Signets (${marks.length})`)), panel);
  }

  // ---------- Aller à la page ----------
  function openGoTo(): void {
    if (!viewer) return;
    const total = pageCount();
    const current = position().page + 1;
    const sheet = createSheet({ title: 'Aller à la page', kind: 'bottom', testId: 'pdf-go-sheet' });
    const number = h('input', { type: 'number', className: 'input', min: 1, max: total, value: current, inputmode: 'numeric', 'aria-label': `Numéro de page, de 1 à ${total}`, 'data-testid': 'pdf-go-input' });
    const slider = h('input', { type: 'range', className: 'range', min: 1, max: total, step: 1, value: current, 'aria-label': 'Page', 'data-testid': 'pdf-go-range' });
    slider.addEventListener('input', () => (number.value = slider.value));
    number.addEventListener('input', () => (slider.value = number.value));
    const go = () => {
      const n = Math.round(Number(number.value));
      if (!Number.isFinite(n) || n < 1 || n > total) {
        number.setCustomValidity(`Une page entre 1 et ${total}.`);
        number.reportValidity();
        return;
      }
      sheet.close();
      goToPage(n - 1);
    };
    number.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), go()));
    add(sheet.body, h('div', { className: 'pdf-go-page' },
      number, slider,
      h('div', { className: 'sheet-actions' }, h('button', { type: 'button', className: 'btn btn-primary', 'data-testid': 'pdf-go-confirm', onclick: go }, 'Aller')),
    ));
    sheet.el.addEventListener('close', () => sheet.el.remove());
    sheet.open();
    number.select();
  }

  // ---------- Affichage ----------
  let settingsSheet: Sheet | null = null;
  function openSettings(): void {
    if (!settings) return;
    settingsSheet ??= createSheet({ title: 'Affichage du PDF', kind: 'bottom', testId: 'settings-sheet' });
    if (!sheets.includes(settingsSheet)) sheets.push(settingsSheet);
    const s = settings;
    const updateReader = (patch: Partial<ReaderSettings>) => {
      settings = { ...settings!, ...patch };
      applyReaderSettings(settings);
      void applyReaderNative(settings);
      saveReaderSettings(settings).catch((err: unknown) => logError('réglages', err));
      if (patch.theme && prefs.colors === 'theme') rebuildKeepingPlace();
    };
    const updatePrefs = (patch: Partial<PdfViewPrefs>) => {
      const before = prefs;
      prefs = { ...prefs, ...patch };
      savePdfPrefs(prefs).catch((err: unknown) => logError('réglages', err));
      if (patch.colors && patch.colors !== before.colors) rebuildKeepingPlace();
      else if (patch.scroll && patch.scroll !== before.scroll) {
        const at = position();
        applyLayout();
        goToPage(at.page);
      }
    };
    const brightness = h('input', { type: 'range', className: 'range', min: BRIGHTNESS_RANGE.min, max: BRIGHTNESS_RANGE.max, step: 0.05, value: s.brightness, 'aria-label': 'Luminosité', 'data-testid': 'range-Luminosité' });
    brightness.addEventListener('input', () => applyReaderSettings({ ...settings!, brightness: Number(brightness.value) }));
    brightness.addEventListener('change', () => updateReader({ brightness: Number(brightness.value) }));
    settingsSheet.body.replaceChildren();
    add(settingsSheet.body,
      h('h3', { className: 'settings-group' }, 'Lecture'),
      segmented<'pages' | 'text'>('Mode de lecture', 'pdf-mode', [['pages', 'Pages originales'], ['text', 'Texte adapté']], 'pages', (mode) => mode === 'text' && void switchToText()),
      h('p', { className: 'hint' }, 'Texte adapté : le PDF devient un livre qui se réagence (taille du texte, thèmes), avec surlignage, fiches et méthode.'),
      segmented<PdfViewPrefs['scroll']>('Défilement', 'pdf-scroll', [['vertical', 'Continu'], ['pages', 'Page par page']], prefs.scroll, (scroll) => updatePrefs({ scroll })),
      h('div', { className: 'setting' },
        h('span', { className: 'setting-label' }, 'Zoom'),
        h('div', { className: 'stepper' },
          h('button', { type: 'button', className: 'btn', 'aria-label': 'Réduire', 'data-testid': 'pdf-zoom-out', onclick: () => zoom(1 / 1.25) }, icon('minus')),
          h('button', { type: 'button', className: 'btn', 'data-testid': 'pdf-zoom-fit', onclick: () => zoom(0) }, 'Ajuster'),
          h('button', { type: 'button', className: 'btn', 'aria-label': 'Agrandir', 'data-testid': 'pdf-zoom-in', onclick: () => zoom(1.25) }, icon('plus')),
        ),
      ),
      h('h3', { className: 'settings-group' }, 'Couleurs'),
      segmented<Theme>('Thème', 'set-theme', THEMES, s.theme, (theme) => updateReader({ theme }), 'swatches'),
      segmented<PdfViewPrefs['colors']>('Pages', 'pdf-colors', [['theme', 'Aux couleurs du thème'], ['original', 'Couleurs d’origine']], prefs.colors, (colors) => updatePrefs({ colors })),
      h('div', { className: 'setting' }, h('span', { className: 'setting-label' }, 'Luminosité'), brightness),
      isNative() ? toggle('Touches de volume pour tourner les pages', 'set-volume', s.volumeKeys, (volumeKeys) => updateReader({ volumeKeys }), 'Pendant la musique, elles règlent le son.') : null,
      isNative() ? toggle('Écran toujours allumé pendant la lecture', 'set-awake', s.keepAwake, (keepAwake) => updateReader({ keepAwake })) : null,
      h('p', { className: 'hint' }, 'Touche le centre pour les menus, les bords pour tourner les pages. Deux doigts ou un double appui pour zoomer.'),
    );
    settingsSheet.open();
  }

  function rebuildKeepingPlace(): void {
    const at = position();
    buildViewer(at);
  }

  async function switchToText(): Promise<void> {
    persist();
    settingsSheet?.close();
    const { page, offset } = position();
    try {
      await saveJump(bookId, pageCount() ? (page + offset) / pageCount() : 0);
      await updateBook(bookId, { pdfView: 'text' });
    } catch (err) {
      logError('pdf', err);
    }
    navigate({ name: 'reader', bookId, view: 'text' });
  }

  // ---------- Musique ----------
  let ambianceRef: ReturnType<typeof ambianceSheet> | null = null;
  function openAmbiance(): void {
    if (!ambianceRef) {
      ambianceRef = ambianceSheet(bookId);
      sheets.push(ambianceRef);
    }
    ambianceRef.open();
  }
  cleanup.push(ambiance.onChange(() => {
    ambianceButton.dataset.state = ambiance.playing;
    ambianceButton.setAttribute('aria-pressed', String(ambiance.playing === 'playing'));
  }));

  // ---------- Gestes ----------
  const modalOpen = () => sheets.some((s) => s.isOpen) || !!document.querySelector('dialog[open]');
  let lastTap: { t: number; x: number; y: number } | null = null;
  let tapTimer: number | undefined;
  scroller.addEventListener('click', (e) => {
    const target = e.target as Element;
    if (target.closest('a, .annotationLayer section') || !(window.getSelection()?.isCollapsed ?? true)) return;
    const now = performance.now();
    // Double appui : zoom ×2 à cet endroit, ou retour à l'ajustement.
    if (lastTap && now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
      window.clearTimeout(tapTimer);
      lastTap = null;
      if (isFitted()) zoom(2, [e.clientX, e.clientY]);
      else zoom(0);
      return;
    }
    lastTap = { t: now, x: e.clientX, y: e.clientY };
    const x = e.clientX / Math.max(1, scroller.clientWidth);
    window.clearTimeout(tapTimer);
    tapTimer = window.setTimeout(() => {
      lastTap = null;
      if (x < TAP_EDGE) turn(-1);
      else if (x > 1 - TAP_EDGE) turn(1);
      else setChrome(!chromeVisible());
    }, DOUBLE_TAP_MS);
  });
  scroller.addEventListener('scroll', () => onMove(), { passive: true });

  const removeVolume = onVolumeKey((dir) => {
    if (!modalOpen()) turn(dir);
  });
  const onKeyDown = (e: KeyboardEvent) => {
    if (modalOpen() || (e.target as Element).closest?.('input, textarea, select')) return;
    if ((e.key === ' ' || e.key === 'Enter') && (e.target as Element).closest?.('button, a')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && prefs.scroll === 'pages')) {
      e.preventDefault();
      turn(1);
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      turn(-1);
    } else if (e.key === 'Escape') {
      setChrome(!chromeVisible());
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      openFind();
    }
  };
  document.addEventListener('keydown', onKeyDown);
  const clockTimer = window.setInterval(updateStatus, 30_000);
  cleanup.push(() => document.removeEventListener('keydown', onKeyDown), removeVolume, () => window.clearInterval(clockTimer));

  function showMessage(text: string, action?: HTMLElement): void {
    scroller.hidden = true;
    message.hidden = false;
    message.replaceChildren(text, ...(action ? [h('br'), h('br'), action] : []));
  }

  // ---------- Ouverture ----------
  (async () => {
    book = (await getBook(bookId)) ?? null;
    if (!book) throw new Error('Ce livre n’est plus dans la bibliothèque.');
    bookTitle.textContent = book.title;
    [settings, prefs, marks] = await Promise.all([loadReaderSettings(), loadPdfPrefs(), loadPageMarks(bookId, book.pageCount)]);
    const progress = await getProgress(bookId);
    if (destroyed) return;
    applyReaderSettings(settings);
    void applyReaderNative(settings);
    // Sélection du texte des pages : le menu d'Android (copier, partager…) reste disponible.
    void setCustomSelectionMenu(false);
    showMessage('Ouverture du PDF…');
    const [pdf, viewerLib] = await Promise.all([
      openPdf(new Uint8Array(await book.file.arrayBuffer()), book.file, pdfOptions((_, text) => text && message.replaceChildren(text), 'Ouverture du PDF')),
      loadPdfViewer(),
    ]);
    if (destroyed) {
      pdf.close();
      return;
    }
    opened = pdf;
    lib = viewerLib;
    message.hidden = true;
    scroller.hidden = false;
    toolButtons.hidden = false;
    footer.hidden = false;
    if (!book.pageCount || book.pageCount !== pdf.doc.numPages) {
      book = { ...book, pageCount: pdf.doc.numPages };
      void updateBook(bookId, { pageCount: pdf.doc.numPages }).catch((err: unknown) => logError('pdf', err));
    }
    // Retour du texte adapté : l'endroit équivalent du livre ; sinon la dernière page lue.
    const total = pdf.doc.numPages;
    const at = progress?.jump !== undefined
      ? { page: Math.min(total - 1, Math.floor(progress.jump * total)), offset: progress.jump * total - Math.min(total - 1, Math.floor(progress.jump * total)) }
      : progress?.page !== undefined ? { page: progress.page, offset: progress.pageOffset ?? 0 } : undefined;
    buildViewer(at);
    // Zoom à deux doigts (gestionnaire de gestes de pdf.js). Sur un très vieil Android, il peut
    // manquer : la lecture continue, avec le double appui et les boutons de zoom.
    try {
      const pinch = new AbortController();
      cleanup.push(() => pinch.abort());
      new lib.pdfjs.TouchManager({
        container: scroller,
        isPinchingDisabled: () => !viewer,
        onPinching: (origin: [number, number], prevDistance: number, distance: number) => {
          if (prevDistance > 0) zoom(distance / prevDistance, origin);
        },
        onPinchEnd: () => refreshSnap(),
        signal: pinch.signal,
      });
    } catch (err) {
      logError('zoom', err);
    }
    const [ambiancePrefs, chosen] = await Promise.all([loadAmbiancePrefs(), getBookAmbiance(bookId)]);
    if (destroyed) return;
    ambiance.setVolume(ambiancePrefs.volume);
    if (chosen) void ambiance.play(chosen).catch((err: unknown) => logError('ambiance', err));
    await touchBook(bookId);
  })().catch((err: unknown) => {
    if (destroyed) return;
    if (err instanceof ImportCancelled) {
      bookTitle.textContent = 'PDF protégé';
      showMessage('Ce PDF est protégé par un mot de passe : sans lui, il ne peut pas être ouvert. Reviens à la bibliothèque et rouvre-le pour le saisir.');
      return;
    }
    logError('ouverture pdf', err);
    bookTitle.textContent = 'PDF illisible';
    showMessage(`Impossible d’ouvrir ce PDF : ${errorMessage(err)}`);
    toast('Ce PDF n’a pas pu être ouvert.', 'error');
  });

  return {
    el,
    onBack() {
      if (!findBar.hidden) {
        closeFind();
        return true;
      }
      return false;
    },
    destroy() {
      destroyed = true;
      if (saveTimer !== undefined) persist();
      window.clearTimeout(tapTimer);
      window.clearTimeout(findTimer);
      ambiance.stop();
      ambianceRef?.dispose();
      viewer?.setDocument(null as never);
      viewerAbort?.abort();
      opened?.close();
      void applyReaderNative(null);
      void setImmersive(false);
      cleanup.forEach((fn) => fn());
      sheets.forEach((s) => s.el.remove());
    },
  };
}

