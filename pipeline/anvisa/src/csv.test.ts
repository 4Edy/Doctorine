import { describe, expect, it } from 'vitest';
import { lerCsv } from './csv.js';

describe('lerCsv', () => {
  it('lê campos com e sem aspas e campos vazios', () => {
    expect(lerCsv('"a";2;;"d"\n')).toEqual([{ linha: 1, campos: ['a', '2', '', 'd'] }]);
  });

  it('mantém o separador e as aspas escapadas dentro das aspas', () => {
    const [r] = lerCsv('"a;b";"diz ""oi"""\n');
    expect(r?.campos).toEqual(['a;b', 'diz "oi"']);
  });

  it('aceita quebra de linha dentro das aspas e numera pela linha onde o registro começa', () => {
    const r = lerCsv('"x";"y"\n"a\nb";"c"\n"z";"w"\n');
    expect(r.map((x) => x.linha)).toEqual([1, 2, 4]);
    expect(r[1]?.campos).toEqual(['a\nb', 'c']);
  });

  it('aceita CRLF e arquivo sem quebra final', () => {
    expect(lerCsv('a;b\r\nc;d').map((x) => x.campos)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('ignora linhas em branco', () => {
    expect(lerCsv('a;b\n\n\nc;d\n').map((x) => x.linha)).toEqual([1, 4]);
  });

  it('um campo vazio no fim da linha conta como coluna', () => {
    expect(lerCsv('a;b;\n')[0]?.campos).toEqual(['a', 'b', '']);
    expect(lerCsv('a;b;')[0]?.campos).toEqual(['a', 'b', '']);
  });

  it('marca aspas não fechadas (arquivo cortado) sem lançar exceção', () => {
    const r = lerCsv('a;b\n"c";"d');
    expect(r).toHaveLength(2);
    expect(r[1]).toMatchObject({ linha: 2, erro: expect.stringContaining('aspas não fechadas') });
  });

  it('marca lixo depois das aspas de fechamento e segue para o próximo registro', () => {
    const r = lerCsv('"a"x;b\nc;d\n');
    expect(r[0]?.erro).toContain('depois das aspas');
    expect(r[1]).toEqual({ linha: 2, campos: ['c', 'd'] });
  });
});
