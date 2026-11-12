import { describe, expect, it } from 'vitest';
import { conferirCabecalho, letraDoArquivo, validarLinha } from './schema.js';

describe('validarLinha', () => {
  it('aceita uma linha válida', () => {
    expect(validarLinha(['DDInter1', 'Abacavir', 'DDInter690', 'Ethanol', 'Minor'])).toEqual({
      ok: true,
      valor: {
        idA: 'DDInter1',
        nomeA: 'Abacavir',
        idB: 'DDInter690',
        nomeB: 'Ethanol',
        nivel: 'Minor',
      },
    });
  });

  it.each([
    [['X1', 'A', 'DDInter2', 'B', 'Minor'], 'DDInterID_A'],
    [['DDInter1', '', 'DDInter2', 'B', 'Minor'], 'Drug_A'],
    [['DDInter1', ' A', 'DDInter2', 'B', 'Minor'], 'Drug_A'],
    [['DDInter1', 'A', 'DDInter2', 'B', 'minor'], 'Level'],
    [['DDInter1', 'A', 'DDInter2', 'B', 'Severe'], 'Level'],
    [['DDInter1', 'A', 'DDInter1', 'A', 'Minor'], 'DDInterID_B'],
  ])('rejeita %j pela coluna %s', (campos, coluna) => {
    const r = validarLinha(campos);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.colunas).toContain(coluna);
  });
});

describe('conferirCabecalho', () => {
  it('aceita o cabeçalho esperado e recusa qualquer outro', () => {
    expect(
      conferirCabecalho(['DDInterID_A', 'Drug_A', 'DDInterID_B', 'Drug_B', 'Level']),
    ).toBeNull();
    expect(conferirCabecalho(['DDInterID_A', 'Drug_A', 'DDInterID_B', 'Drug_B'])).toContain(
      'diferente',
    );
    expect(
      conferirCabecalho(['DDInterID_A', 'Drug_A', 'DDInterID_B', 'Drug_B', 'Severity']),
    ).toContain('Severity');
  });
});

describe('letraDoArquivo', () => {
  it('reconhece o nome com ou sem prefixo', () => {
    expect(letraDoArquivo('ddinter_downloads_code_B.csv')).toBe('B');
    expect(letraDoArquivo('68dedba5-ddinter_downloads_code_B.csv')).toBe('B');
    expect(letraDoArquivo('ddinter_downloads_code_B.csv.bak')).toBeNull();
    expect(letraDoArquivo('outro.csv')).toBeNull();
  });
});
