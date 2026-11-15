import { describe, expect, it } from 'vitest';
import { coachTips, emptyMnemonic, fillFromTable, hasMnemonic, hintText, importRecallTable, nextFreeNumber, normalizeMojorTable, tableCoverage, tableToJson, type MojorTable } from '../../src/core/mnemonic';

describe('table de rappel', () => {
  it('accepte le tableau d’origine et le format enregistré ; lieux, personnages et sons sont laissés de côté', () => {
    const a = normalizeMojorTable([{ number: 1, word: 'Thé', verb: 'verser', place: 'Cuisine', sound: 'glou' }, { number: '2', word: 'Noé ' }, { word: 'sans numéro' }, { number: 3, place: 'Port' }, null]);
    expect(a.get(1)).toEqual({ word: 'Thé', verb: 'verser' });
    expect(a.get(2)).toEqual({ word: 'Noé' });
    expect(a.has(3)).toBe(false);
    expect(a.size).toBe(2);
    const b = normalizeMojorTable({ '7': { number: 7, word: 'Coq', place: 'Ferme' } });
    expect(b.get(7)).toEqual({ word: 'Coq' });
    expect(normalizeMojorTable(tableToJson(b))).toEqual(b);
    expect(normalizeMojorTable('x').size).toBe(0);
  });

  it('export de Memoria : la table la plus remplie, numéro dans « number » ou dans « value »', () => {
    const memoria = {
      tables: [
        { id: 1, title: null, associations: [
          { number: 0, value: null, name: 'Seau', imagePath: 'https://images.example/seau.jpg', imageSource: 'network' },
          { number: 1, value: null, name: 'Dé ', imageSource: 'local' },
          { number: null, value: '42', name: 'Reine ' },
          { number: null, value: '100', name: 'Sang' },
          { number: null, value: 'x', name: 'Ignoré' },
        ] },
        { id: 2, title: 'table couleurs ', associations: [{ number: null, value: '10', name: 'Bleu' }] },
        { id: 3, title: 'personnage ', associations: [{ number: null, value: '0', name: 'Cendrillon ' }] },
      ],
    };
    const { table, from } = importRecallTable(memoria);
    expect(from).toBe('Memoria');
    expect([...table]).toEqual([[0, { word: 'Seau' }], [1, { word: 'Dé' }], [42, { word: 'Reine' }], [100, { word: 'Sang' }]]);
  });

  it('sauvegarde de SECK 5D : la table active, « 7 » plutôt que « 07 »', () => {
    const seck = {
      app: 'seck5d', version: 5, activeId: 'b',
      tables: [
        { id: 'a', name: 'Autre', kind: 'single', images: { 0: 'Œuf' } },
        { id: 'b', name: 'Système majeur', kind: 'major110', images: { 0: 'Seau', 7: 'Camp', '07': 'Sac', 12: 'Dîner', 99: 'Bob', '': 'vide' } },
      ],
      palaces: [], books: [], photoData: {},
    };
    const { table, from } = importRecallTable(seck);
    expect(from).toBe('SECK 5D, « Système majeur »');
    expect(table.get(7)).toEqual({ word: 'Camp' });
    expect([...table.keys()].sort((a, b) => a - b)).toEqual([0, 7, 12, 99]);
    // Ancienne table SECK (0–100, plusieurs champs) : l'objet est l'image, l'action reste.
    const old = importRecallTable({ table: [{ number: 5, object: 'Lion', color: 'Ocre', sound: 'ROUAR', person: 'Dompteur', action: 'Fait claquer le fouet', location: 'Savane' }, { number: 6, person: 'Gamer' }] });
    expect(old.table.get(5)).toEqual({ word: 'Lion', verb: 'Fait claquer le fouet', color: 'Ocre' });
    expect(old.table.get(6)).toEqual({ word: 'Gamer' });
  });

  it('complétude : images de 0 au plus grand numéro, et numéros manquants', () => {
    const full: MojorTable = new Map(Array.from({ length: 101 }, (_, n) => [n, { word: `Image ${n}` }]));
    expect(tableCoverage(full)).toEqual({ count: 101, max: 100, missing: [] });
    full.delete(37);
    full.set(58, { verb: 'sans image' });
    expect(tableCoverage(full)).toEqual({ count: 99, max: 100, missing: [37, 58] });
    expect(tableCoverage(new Map())).toEqual({ count: 0, max: -1, missing: [] });
  });

  it('complète les champs vides ; un autre numéro remplace ce que l’ancien avait rempli, pas ce qui a été écrit', () => {
    const table = normalizeMojorTable([{ number: 3, word: 'Mât', verb: 'grimper' }, { number: 5, word: 'Lion' }]);
    const m = fillFromTable({ ...emptyMnemonic(), number: 3, word: 'Mon mot' }, table);
    expect(m).toMatchObject({ word: 'Mon mot', verb: 'grimper' });
    const auto = fillFromTable({ ...emptyMnemonic(), number: 3 }, table);
    expect(auto).toMatchObject({ word: 'Mât', verb: 'grimper' });
    expect(fillFromTable({ ...auto, number: 5 }, table, 3)).toMatchObject({ word: 'Lion', verb: '' });
    expect(fillFromTable({ ...auto, number: 5, verb: 'rugit sur la page' }, table, 3)).toMatchObject({ word: 'Lion', verb: 'rugit sur la page' });
  });

  it('trouve le prochain numéro libre', () => {
    expect(nextFreeNumber([0, 1, 3, null])).toBe(2);
    expect(nextFreeNumber(Array.from({ length: 100 }, (_, i) => i))).toBeNull();
  });
});

describe('coach et indice', () => {
  it('guide vers un numéro, son image et une action vivante', () => {
    expect(coachTips(emptyMnemonic(), 'qa')).toHaveLength(3);
    expect(coachTips({ ...emptyMnemonic(), number: 4 }, 'qa')[0]).toContain('n’a pas d’image');
    expect(coachTips({ ...emptyMnemonic(), number: 4, word: 'Roi' }, 'sequence')[0]).toContain('les étapes');
    const full = { ...emptyMnemonic(), number: 4, word: 'Roi', verb: 'jongle avec les chapitres' };
    expect(coachTips(full, 'qa')).toEqual([expect.stringContaining('Scène complète')]);
    expect(coachTips(full, 'qa').join(' ')).not.toMatch(/lieu|personnage/i);
  });

  it('indice : numéro, image, action ; lieux, personnages et sons ne s’affichent plus', () => {
    expect(hintText({ ...emptyMnemonic(), number: 4, place: 'Cuisine', person: 'Ma sœur', word: 'Roi', verb: 'clignote', sound: 'bip' })).toBe('n° 4 · Roi · clignote');
    expect(hasMnemonic(emptyMnemonic())).toBe(false);
    expect(hasMnemonic({ ...emptyMnemonic(), sound: 'bip', place: 'Cuisine', person: 'Moi' })).toBe(false);
    expect(hasMnemonic({ ...emptyMnemonic(), number: 0 })).toBe(true);
  });
});
