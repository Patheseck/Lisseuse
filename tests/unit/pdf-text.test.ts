import { describe, expect, it } from 'vitest';
import { convertPdfText, FRONT_LABEL, isOcrJunk, PDF_CHUNK_WORDS, unreadableRatio, type PdfItem, type PdfOutlineEntry, type PdfPageText } from '../../src/book/pdf-text';

// Pages construites à la main : une entrée par morceau de texte, comme pdf.js les rend.
const item = (str: string, x: number, y: number, size = 11, font = 'corps'): PdfItem => ({ str, x, y, width: str.length * size * 0.46, size, font });
const page = (...items: PdfItem[]): PdfPageText => ({ width: 420, height: 595, items });
/** Lignes de texte courant, de haut en bas, à 14 pt d'interligne ; « > » en tête : alinéa. */
function body(lines: string[], top = 500, left = 50): PdfItem[] {
  return lines.map((l, i) => (l.startsWith('>') ? item(l.slice(1), left + 15, top - i * 14) : item(l, left, top - i * 14)));
}
const html = (pages: PdfPageText[], outline: PdfOutlineEntry[] = [], title = 'Livre') => convertPdfText(pages, outline, title);
const all = (pages: PdfPageText[], outline: PdfOutlineEntry[] = []) => html(pages, outline).chapters.map((c) => c.html).join('\n');

/** Ligne pleine (justifiée jusqu'à la marge de droite) : environ 62 caractères. */
const FULL = 'Le texte de ce livre occupe toute la largeur de la ligne ici';
/** Paragraphe de contexte : donne au convertisseur le corps du texte et les marges, comme une vraie page. */
const CONTEXT = ['>' + FULL, FULL, FULL, 'Fin du paragraphe de contexte.'];

describe('PDF : lignes et paragraphes', () => {
  it('rassemble les morceaux d’une ligne et ajoute les espaces manquantes', () => {
    const out = all([page(item('Le', 50, 500), item('sommeil', 64, 500), item(' ', 100, 500), item('aide.', 104, 500))]);
    expect(out).toBe('<p>Le sommeil aide.</p>');
  });

  it('ignore le texte doublé pour simuler le gras', () => {
    expect(all([page(item('Titre gras', 50, 500), item('Titre gras', 50.4, 500))])).toBe('<p>Titre gras</p>');
  });

  it('coupe les paragraphes à l’alinéa, à l’espace vide et après une dernière ligne courte', () => {
    const out = all([page(...body([
      '>Premier paragraphe qui court sur toute la largeur de la ligne,', FULL, 'et finit ici.',
      'Deuxième paragraphe après une ligne courte, il occupe la ligne', 'mais continue sans alinéa.',
    ]), ...body(['Troisième, après un blanc.'], 400))]);
    expect(out).toBe([
      '<p>Premier paragraphe qui court sur toute la largeur de la ligne, Le texte de ce livre occupe toute la largeur de la ligne ici et finit ici.</p>',
      '<p>Deuxième paragraphe après une ligne courte, il occupe la ligne mais continue sans alinéa.</p>',
      '<p>Troisième, après un blanc.</p>',
    ].join('\n'));
  });

  it('un paragraphe continue d’une page à l’autre', () => {
    const out = all([page(...body(['>Une phrase commence en bas de la page et occupe la ligne', FULL])), page(...body(['et se termine sur la page suivante.']))]);
    expect(out).toBe(`<p>Une phrase commence en bas de la page et occupe la ligne ${FULL} et se termine sur la page suivante.</p>`);
  });

  it('remet dans l’ordre les lignes d’une page écrites dans le désordre', () => {
    expect(all([page(item('et sa fin.', 50, 486), item('Le début de la phrase, sur toute la largeur de la ligne ici', 50, 500))])).toBe('<p>Le début de la phrase, sur toute la largeur de la ligne ici et sa fin.</p>');
  });

  it('garde l’ordre du fichier pour une page en deux colonnes', () => {
    const left = [0, 1, 2].map((i) => item(`gauche ${i}`, 40, 500 - i * 14));
    const right = [0, 1, 2].map((i) => item(`droite ${i}`, 230, 500 - i * 14));
    const out = all([page(...left, ...right)]);
    expect(out.indexOf('gauche 2')).toBeLessThan(out.indexOf('droite 0'));
  });

  it('échappe le texte (aucune balise ne passe)', () => {
    expect(all([page(item('a < b & <script>', 50, 500))])).toBe('<p>a &lt; b &amp; &lt;script&gt;</p>');
  });
});

describe('PDF : mots coupés en fin de ligne', () => {
  /** Paragraphe après le contexte : seul son HTML est renvoyé. */
  const join = (...lines: string[]) => all([page(...body([...CONTEXT, ...lines.map((l, i) => (i === 0 ? `>${l}` : l))]))]).split('\n').at(-1);

  it('recolle un mot coupé par la mise en page', () => {
    expect(join('Le cerveau rejoue les souve-', 'nirs de la journée.')).toBe('<p>Le cerveau rejoue les souvenirs de la journée.</p>');
  });

  it('garde le trait d’union des mots composés', () => {
    expect(join('Il faut peut-', 'être dormir, c’est-à-', 'dire sept heures.')).toBe('<p>Il faut peut-être dormir, c’est-à-dire sept heures.</p>');
    expect(join('Il a rencontré Jean-', 'Paul en 1914-', '1918.')).toBe('<p>Il a rencontré Jean-Paul en 1914-1918.</p>');
  });

  it('se fie aux autres occurrences du mot dans le livre', () => {
    // « porte-monnaie » écrit ailleurs avec son trait d'union : il le garde en fin de ligne aussi.
    expect(join('Il cherche son porte-monnaie partout dans la maison, puis le', 'porte-', 'monnaie apparaît.')).toBe('<p>Il cherche son porte-monnaie partout dans la maison, puis le porte-monnaie apparaît.</p>');
    // « retrouvailles » écrit ailleurs d'un seul tenant : la coupure disparaît.
    expect(join('Les retrouvailles furent longues à venir, et ces retrou-', 'vailles furent belles.')).toBe('<p>Les retrouvailles furent longues à venir, et ces retrouvailles furent belles.</p>');
  });

  it('retire le trait d’union conditionnel', () => {
    expect(join('Une cou\u00AD', 'pure invisible.')).toBe('<p>Une coupure invisible.</p>');
  });
});

describe('PDF : en-têtes, numéros de page, notes, lettrines', () => {
  const header = () => item('LE SOMMEIL', 170, 560, 8);
  const folio = (n: number) => item(String(n), 205, 35, 9);

  it('retire en-têtes courants et numéros de page, garde les titres', () => {
    const pages = ['un', 'deux', 'trois', 'quatre'].map((n, i) => page(header(), ...body([...CONTEXT, `>La page ${n} se termine ici.`]), folio(i + 1)));
    pages[0]!.items.unshift(item('Le sommeil', 50, 540, 18));
    const out = all(pages);
    expect(out).not.toContain('LE SOMMEIL');
    expect(out).not.toMatch(/>[1-4]</);
    expect(out).toContain('<h3>Le sommeil</h3>');
    expect(out).toContain('<p>La page quatre se termine ici.</p>');
  });

  it('un nombre seul en fin de phrase n’est pas un numéro de page', () => {
    expect(all([page(...body([...CONTEXT, '>La guerre dura de 1914 à', '1918.']))]).split('\n').at(-1)).toBe('<p>La guerre dura de 1914 à 1918.</p>');
  });

  it('sort les notes de bas de page du texte et garde l’appel en exposant', () => {
    const out = all([page(...body(CONTEXT, 540), item('>Le sommeil consolide.'.slice(1), 65, 470), item('1', 170, 474, 7), item('Il trie aussi.', 65, 456), item('1. Selon une étude de 2004,', 50, 70, 8), item('menée sur 40 personnes.', 50, 60, 8), folio(1))]);
    expect(out.split('\n').slice(1)).toEqual(['<p>Le sommeil consolide.<sup>1</sup></p>', '<p>Il trie aussi.</p>', '<section role="doc-endnotes" aria-label="Notes"><p>1. Selon une étude de 2004, menée sur 40 personnes.</p></section>']);
  });

  it('recolle la lettrine au mot qui suit', () => {
    expect(all([page(...body(CONTEXT, 560), item('L', 50, 490, 40), item('e sommeil arrive enfin, sur toute la largeur de la ligne,', 80, 500), item('et la suite.', 50, 486))]).split('\n').at(-1)).toBe('<p>Le sommeil arrive enfin, sur toute la largeur de la ligne, et la suite.</p>');
    // Une majuscule seule de taille normale n'est pas une lettrine.
    expect(all([page(...body(CONTEXT, 560), item('A', 65, 500), item('bientôt.', 75, 500))]).split('\n').at(-1)).toBe('<p>A bientôt.</p>');
  });
});

describe('PDF : chapitres', () => {
  const chapterPage = (title: string, text: string, size = 18) => page(item(title, 50, 470, size), ...body([`>${text}`, ...CONTEXT], 430));

  it('suit les signets du PDF, et garde le début du livre', () => {
    const pages = [page(item('Mon livre', 100, 400, 24)), chapterPage('Chapitre 1', 'Le texte un.'), chapterPage('Chapitre 2', 'Le texte deux.')];
    const outline: PdfOutlineEntry[] = [{ title: 'Chapitre 1', level: 0, page: 1, y: 488 }, { title: 'Chapitre 2', level: 0, page: 2, y: 488 }];
    const res = html(pages, outline);
    expect(res.structure).toBe('outline');
    expect(res.chapters.map((c) => c.label)).toEqual([FRONT_LABEL, 'Chapitre 1', 'Chapitre 2']);
    expect(res.chapters[1]!.html.split('\n').slice(0, 2)).toEqual(['<h2>Chapitre 1</h2>', '<p>Le texte un.</p>']);
  });

  it('se cale sur le titre quand le signet pointe juste en dessous', () => {
    const pages = [chapterPage('Le sommeil', 'Texte A.'), chapterPage('Les rêves', 'Texte B.')];
    const outline: PdfOutlineEntry[] = [{ title: 'Le sommeil', level: 0, page: 0, y: 440 }, { title: 'Les rêves', level: 0, page: 1, y: 440 }];
    expect(html(pages, outline).chapters.map((c) => c.html.split('\n')[0])).toEqual(['<h2>Le sommeil</h2>', '<h2>Les rêves</h2>']);
  });

  it('signets « Chapitre 1 » et « Chapitre 10 » : chacun reste sur son titre', () => {
    // Un chapitre 1 très court, juste avant le chapitre 10.
    const pages = [page(item('Chapitre 1', 50, 470, 18), ...body(['>Court.'], 430)), chapterPage('Chapitre 10', 'Dixième.')];
    const outline: PdfOutlineEntry[] = [{ title: 'Chapitre 1', level: 0, page: 0, y: 488 }, { title: 'Chapitre 10', level: 0, page: 1, y: 488 }];
    const res = html(pages, outline);
    expect(res.chapters.map((c) => c.label)).toEqual(['Chapitre 1', 'Chapitre 10']);
    expect(res.chapters[0]!.html).toContain('Court.');
    expect(res.chapters[1]!.html.split('\n')[0]).toBe('<h2>Chapitre 10</h2>');
  });

  it('parties et chapitres : une partie vide disparaît, les chapitres d’une partie sont décalés', () => {
    const pages = [page(item('PREMIÈRE PARTIE', 50, 400, 20), ...body(CONTEXT, 300)), chapterPage('Chapitre 1', 'Un.'), chapterPage('Chapitre 2', 'Deux.'), chapterPage('Chapitre 3', 'Trois.')];
    const outline: PdfOutlineEntry[] = [
      { title: 'Première partie', level: 0, page: 0, y: null },
      { title: 'Chapitre 1', level: 1, page: 1, y: null },
      { title: 'Chapitre 2', level: 1, page: 2, y: null },
      { title: 'Deuxième partie', level: 0, page: 3, y: null },
      { title: 'Chapitre 3', level: 1, page: 3, y: null },
    ];
    const res = html(pages, outline);
    expect(res.chapters.map((c) => [c.label, c.depth ?? 0])).toEqual([['Première partie', 0], ['Chapitre 1', 1], ['Chapitre 2', 1], ['Chapitre 3', 1]]);
  });

  it('sans signets : les titres plus grands que le texte ouvrent les chapitres', () => {
    const pages = [page(item('Titre du livre', 80, 400, 26)), chapterPage('Le sommeil', 'Texte A.'), page(item('Une section', 50, 470, 14), ...body(['>Texte.', ...CONTEXT], 440)), chapterPage('Les rêves', 'Texte B.')];
    const res = html(pages);
    expect(res.structure).toBe('headings');
    // Le titre du livre (une seule fois) reste dans le début du livre.
    expect(res.chapters.map((c) => c.label)).toEqual([FRONT_LABEL, 'Le sommeil', 'Les rêves']);
    expect(res.chapters[0]!.html).toContain('<h2>Titre du livre</h2>');
    expect(res.chapters[1]!.html).toContain('<h3>Une section</h3>');
  });

  it('une grande lettre seule (« I », « V ») est un numéro de chapitre, pas une lettrine', () => {
    // Numéro centré au-dessus du texte (et non à sa gauche, à sa hauteur) : il reste un titre.
    const numbered = (n: string, text: string) => page(item(n, 200, 470, 40), ...body([`>${text}`, ...CONTEXT], 420));
    const res = html([numbered('I', 'Le premier.'), numbered('II', 'Le deuxième.'), numbered('V', 'Le cinquième.')]);
    expect(res.chapters.map((c) => c.label)).toEqual(['I', 'II', 'V']);
    expect(res.chapters[0]!.html.split('\n').slice(0, 2)).toEqual(['<h2>I</h2>', '<p>Le premier.</p>']);
  });

  it('le nom de l’auteur à côté du titre répété n’ouvre pas non plus les chapitres', () => {
    // Couverture : titre et auteur de même taille, lus comme un seul titre ; puis le faux-titre.
    const pages = [page(item('KNOCK', 150, 400, 30), item('Jules Romains', 130, 360, 30)), page(item('KNOCK', 150, 400, 30)), chapterPage('Introduction', 'Un.', 16), chapterPage('Acte premier', 'Deux.', 16)];
    expect(html(pages).chapters.map((c) => c.label)).toEqual([FRONT_LABEL, 'Introduction', 'Acte premier']);
  });

  it('ni une réplique (« — Oui… ») ni une adresse web ne sont des titres', () => {
    const pages = [page(item('— Nenni. — M’y voici donc ?', 50, 470, 16), ...body(CONTEXT, 440)), page(item('http://www.archive.org/details/livre', 50, 470, 16), ...body(CONTEXT, 440))];
    expect(html(pages).chapters.map((c) => c.html).join('\n')).not.toMatch(/<h\d>/);
  });

  it('le titre du livre répété (couverture, page de titre) n’ouvre pas les chapitres', async () => {
    const pages = [page(item('Le Grand Livre', 60, 400, 28)), page(item('Le Grand Livre', 60, 400, 28), ...body(CONTEXT, 300)), chapterPage('Premier chapitre', 'Un.', 16), chapterPage('Second chapitre', 'Deux.', 16)];
    expect(html(pages).chapters.map((c) => c.label)).toEqual([FRONT_LABEL, 'Premier chapitre', 'Second chapitre']);
  });

  it('parties et chapitres repérés par leur taille : les chapitres sont décalés sous leur partie', () => {
    const pages = [
      page(item('Première partie', 50, 470, 24), ...body(CONTEXT, 400)),
      chapterPage('Le sommeil', 'Un.', 16), chapterPage('Les rêves', 'Deux.', 16),
      page(item('Deuxième partie', 50, 470, 24), ...body(CONTEXT, 400)),
      chapterPage('Réviser', 'Trois.', 16),
    ];
    expect(html(pages).chapters.map((c) => [c.label, c.depth ?? 0])).toEqual([['Première partie', 0], ['Le sommeil', 1], ['Les rêves', 1], ['Deuxième partie', 0], ['Réviser', 1]]);
  });

  it('sans signets ni titres plus grands : « Chapitre 3 », « Épilogue »… seuls sur leur ligne', () => {
    const pages = [page(...body(['Chapitre premier', ...CONTEXT, 'Chapitre 2', ...CONTEXT, 'Épilogue', '>Fin.']))];
    expect(html(pages).chapters.map((c) => c.label)).toEqual(['Chapitre premier', 'Chapitre 2', 'Épilogue']);
  });

  it('une ligne de table des matières n’est pas un titre', () => {
    const pages = [page(...body(['Chapitre 1 — Dormir . . . . . . . 5', 'Chapitre 2 — Rêver . . . . . . . 23', ...CONTEXT]))];
    const res = html(pages);
    expect(res.chapters).toHaveLength(1);
    expect(res.chapters[0]!.html.split('\n').slice(0, 2)).toEqual(['<p>Chapitre 1 — Dormir . . . . . . . 5</p>', '<p>Chapitre 2 — Rêver . . . . . . . 23</p>']);
  });

  it('sans structure : des tranches de pages', () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `mot${i % 50}`).join(' ');
    // 10 pages de 40 lignes de 25 mots, un paragraphe toutes les 10 lignes : 10 000 mots.
    const pages = Array.from({ length: 10 }, () => page(...Array.from({ length: 40 }, (_, i) => item(`${words(25)}${i % 10 === 9 ? '.' : ''}`, i % 10 === 0 ? 65 : 50, 580 - i * 14, 11))));
    const res = html(pages, [], 'Mon PDF');
    expect(res.structure).toBe('pages');
    expect(res.chapters.map((c) => c.label)).toEqual(['Pages 1 à 5', 'Pages 6 à 10']);
    expect(PDF_CHUNK_WORDS).toBe(5000);
    // Un PDF court reste d'un seul tenant, au titre du livre.
    expect(html([page(...body(['Court.']))], [], 'Mon PDF').chapters.map((c) => c.label)).toEqual(['Mon PDF']);
  });

  it('un PDF sans texte ne donne aucun chapitre', () => {
    expect(html([page(), page()])).toEqual({ chapters: [], words: 0, structure: 'pages' });
  });
});

describe('PDF : poèmes et mots coupés', () => {
  it('les vers d’un poème gardent leurs retours à la ligne ; une phrase finie ferme la strophe', () => {
    const verses = ['La Cigale, ayant chanté', 'Tout l’été,', 'Se trouva fort dépourvue', 'Quand la bise fut venue :', 'Pas un seul petit morceau', 'De mouche ou de vermisseau.', 'Elle alla crier famine', 'Chez la Fourmi sa voisine.'];
    const out = all([page(...verses.map((v, i) => item(v, 70, 500 - i * 14)))]);
    expect(out.split('\n')).toEqual([
      '<p>La Cigale, ayant chanté<br> Tout l’été,<br> Se trouva fort dépourvue<br> Quand la bise fut venue :</p>',
      '<p>Pas un seul petit morceau<br> De mouche ou de vermisseau.</p>',
      '<p>Elle alla crier famine<br> Chez la Fourmi sa voisine.</p>',
    ]);
    // Le texte lu (recherche, surlignage, voix) garde les mots séparés.
    const doc = new DOMParser().parseFromString(out, 'text/html');
    expect(doc.body.textContent).toContain('chanté Tout l’été, Se trouva');
  });

  it('la prose justifiée garde ses paragraphes d’un seul tenant', () => {
    expect(all([page(...body(CONTEXT))])).not.toContain('<br>');
  });

  it('un mot coupé en fin de ligne : le paragraphe continue, même après un écart ou un retrait', () => {
    const out = all([page(...body(CONTEXT, 560), item('Ses flâneries et ses longues ran-', 50, 486), item('données dans les quartiers voisins.', 58, 466))]);
    expect(out.split('\n').at(-1)).toBe('<p>Ses flâneries et ses longues randonnées dans les quartiers voisins.</p>');
  });
});

describe('PDF scanné (texte reconnu par OCR)', () => {
  const ocr = (pages: PdfPageText[], outline: PdfOutlineEntry[] = []) => convertPdfText(pages, outline, 'Livre', { ocr: true });

  it('reconnaît les lignes de bruit tirées des illustrations, et garde le vrai texte même mal reconnu', () => {
    // Vu sur un vrai livre scanné : logo d'éditeur, couverture, cachet de bibliothèque, ornements.
    for (const junk of ['À oo x 4', '— “ “ ( 4 ’ Ÿ', 'si, RE j d FTHRE', "J } ee L '", 'ft', '-', '1 *o } a', ': " ) LI . M / 5', 'Ed Fe', 'Î', 'x .', 'Ù Fa F', '+=', '&', 'Rss', 'QU Le', '3 3333 08928 7979', 'U dVof OTTAWA', 'ti^fS^^^f^^J^^^',
      '..... KTIQATsb Srsrorri et bis }}) cet po0s oaisottleDent. PLU io sl ts sûo ni']) {
      expect(isOcrJunk(junk), junk).toBe(true);
    }
    for (const text of ['Honnête.', 'Sans histoires.', 'Pourquoi ?', 'Ah !', 'Oui.', '— Non.', 'Il y a un an', 'ACTE II', 'XII', 'Roman', 'Du même auteur', '* * *', 'Le Baobab fou, roman,',
      'Lo Mais aussi l’appréhepsion de mauvaises nouvelles, surtout de déceéz_ Je suis si loin des mieñs,', '(\\ À dernière RSS NE fit une fausse couchee\\S CON Elle R dit beaucoup SES',
      'Elle ne mangeait pas beaucou Elle ne faisait rien beaucoup. P-one à AN Met auf des enfants']) {
      expect(isOcrJunk(text), text).toBe(false);
    }
  });

  it('retire le bruit, garde le texte ; les signes parasites en début de ligne disparaissent', () => {
    const out = ocr([page(...body(['À oo x 4', 'J } ee L \'', '| J’espère qu’elle a pris ce qu’il y a de meilleur.', '#1 Dans une cuisine où les odeurs du pays se reconstituaient.'], 500))]).chapters.map((c) => c.html).join('\n');
    expect(out).toBe('<p>J’espère qu’elle a pris ce qu’il y a de meilleur.</p>\n<p>Dans une cuisine où les odeurs du pays se reconstituaient.</p>');
  });

  it('tailles irrégulières : les lignes restent dans leur paragraphe, les titres d’un même style forment un niveau', () => {
    // Chaque ligne reconnue a sa propre taille (10 à 11,6 pt), et chaque titre la sienne (15 à 17 pt).
    const sizes = [10.4, 11.2, 10, 11.6, 10.6, 10.2];
    const chapter = (title: string, size: number, words: string) => page(
      item(title, 60, 500, size),
      ...[`>Le texte reconnu du chapitre ${words} occupe toute la ligne ici`, `et la suivante aussi (${words}), avec des tailles différentes`, 'selon les lettres de chaque mot que le logiciel a lus', `jusqu’à la fin du paragraphe : ${words}.`, `>Un second paragraphe (${words}) commence après le retrait`, `et se termine sur cette ligne (${words}).`].map((l, i) => {
        const indent = l.startsWith('>');
        return item(indent ? l.slice(1) : l, indent ? 65 : 50, 460 - i * 14, sizes[i]!);
      }),
    );
    const res = ocr([chapter('LA CIGALE ET LA FOURMI', 15.3, 'un'), chapter('LE CORBEAU ET LE RENARD', 16.9, 'deux'), chapter('LE MEUNIER, SON FILS ET L’ÂNE', 14.4, 'trois')]);
    expect(res.chapters.map((c) => c.label)).toEqual(['LA CIGALE ET LA FOURMI', 'LE CORBEAU ET LE RENARD', 'LE MEUNIER, SON FILS ET L’ÂNE']);
    expect(res.chapters[1]!.html.split('\n').filter((l) => l.startsWith('<p>'))).toHaveLength(2);
  });
});

describe('PDF : texte illisible', () => {
  it('mesure la part de caractères sans correspondance', () => {
    expect(unreadableRatio('Le sommeil')).toBe(0);
    expect(unreadableRatio('\uE001\uE002\uE003 a')).toBe(0.75);
    expect(unreadableRatio('')).toBe(0);
  });
});
