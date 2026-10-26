import { describe, expect, it } from 'vitest';
import { splitSteps } from '../../src/ui/card-editor';

describe('splitSteps', () => {
  it('utilise les lignes de liste quand il y en a', () => {
    expect(splitSteps('1. Absorption\n2) Photolyse\n- Calvin')).toEqual(['Absorption', 'Photolyse', 'Calvin']);
  });
  it('sinon découpe en phrases', () => {
    expect(splitSteps('On lave. On coupe ; on cuit !')).toEqual(['On lave.', 'On coupe ;', 'on cuit !']);
  });
});
