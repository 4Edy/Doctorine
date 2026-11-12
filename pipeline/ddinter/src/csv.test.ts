import { describe, expect, it } from 'vitest';
import { lerCsv } from './csv.js';

describe('lerCsv (separador ",")', () => {
  it('lê campos simples, com CRLF', () => {
    expect(lerCsv('a,b,c\r\n1,2,3\r\n').map((r) => r.campos)).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('mantém a vírgula dentro de aspas', () => {
    const [r] = lerCsv('DDInter942,"Interferon alfa-2a, Recombinant",DDInter1202');
    expect(r?.campos).toEqual(['DDInter942', 'Interferon alfa-2a, Recombinant', 'DDInter1202']);
  });

  it('marca aspas não fechadas em vez de lançar exceção', () => {
    const [r] = lerCsv('a,"b');
    expect(r?.erro).toContain('aspas não fechadas');
  });
});
