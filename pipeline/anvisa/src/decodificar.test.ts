import { describe, expect, it } from 'vitest';
import { decodificar } from './decodificar.js';
import { emLatin1 } from './fixtures.js';

describe('decodificar', () => {
  it('lê Windows-1252 (Latin-1) com acentos', () => {
    const r = decodificar(emLatin1('FARMACÊUTICA, água, ç, ã'));
    expect(r).toEqual({ texto: 'FARMACÊUTICA, água, ç, ã', codificacao: 'windows-1252' });
  });

  it('reconhece UTF-8 e remove o BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('água')]);
    expect(decodificar(bytes)).toEqual({ texto: 'água', codificacao: 'utf-8' });
  });

  it('texto só ASCII é rotulado como utf-8', () => {
    expect(decodificar(new TextEncoder().encode('abc')).codificacao).toBe('utf-8');
  });
});
