import { describe, expect, it } from 'vitest';
import { coachTips, emptyMnemonic, fillFromTable, hasMnemonic, hintText, nextFreeNumber, normalizeMojorTable, tableToJson } from '../../src/core/mnemonic';

describe('table Mojor', () => {
  it('accepte le tableau d’origine et le format enregistré par la V5', () => {
    const a = normalizeMojorTable([{ number: 1, word: 'Thé', verb: 'verser' }, { number: '2', word: 'Noé' }, { word: 'sans numéro' }, null]);
    expect(a.get(1)).toEqual({ word: 'Thé', verb: 'verser' });
    expect(a.get(2)).toEqual({ word: 'Noé' });
    expect(a.size).toBe(2);
    const b = normalizeMojorTable({ '7': { number: 7, word: 'Coq', place: 'Ferme' } });
    expect(b.get(7)).toEqual({ word: 'Coq', place: 'Ferme' });
    expect(normalizeMojorTable(tableToJson(b))).toEqual(b);
    expect(normalizeMojorTable('x').size).toBe(0);
  });

  it('complète seulement les champs vides', () => {
    const table = normalizeMojorTable([{ number: 3, word: 'Mât', verb: 'grimper', place: 'Port' }]);
    const m = fillFromTable({ ...emptyMnemonic(), number: 3, word: 'Mon mot' }, table);
    expect(m).toMatchObject({ word: 'Mon mot', verb: 'grimper', place: 'Port' });
  });

  it('trouve le prochain numéro libre', () => {
    expect(nextFreeNumber([0, 1, 3, null])).toBe(2);
    expect(nextFreeNumber(Array.from({ length: 100 }, (_, i) => i))).toBeNull();
  });
});

describe('coach et indice', () => {
  it('guide vers lieu, image vivante et action', () => {
    expect(coachTips(emptyMnemonic(), 'qa')).toHaveLength(3);
    expect(coachTips(emptyMnemonic(), 'sequence')[0]).toContain('trajet');
    const full = { ...emptyMnemonic(), place: 'Cuisine', word: 'Lampe', person: 'Ma sœur', verb: 'jongle' };
    expect(coachTips(full, 'qa')).toEqual([expect.stringContaining('Scène complète')]);
  });

  it('indice : le lieu en premier', () => {
    expect(hintText({ ...emptyMnemonic(), number: 4, place: 'Cuisine', word: 'Lampe', verb: 'clignote' })).toBe('📍 Cuisine · n° 4 · Lampe · clignote');
    expect(hasMnemonic(emptyMnemonic())).toBe(false);
    expect(hasMnemonic({ ...emptyMnemonic(), sound: 'bip' })).toBe(true);
  });
});
