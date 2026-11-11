import { describe, expect, it } from 'vitest';
import { lerCsv } from './csv.js';
import { CABECALHO, LINHAS_AMOSTRA } from './fixtures.js';
import { COLUNAS, conferirCabecalho, validarLinha } from './schema.js';

const campos = (linha: string): string[] => lerCsv(linha)[0]?.campos ?? [];
const sobrescrever = (linha: string, coluna: (typeof COLUNAS)[number], valor: string): string[] => {
  const c = campos(linha);
  c[COLUNAS.indexOf(coluna)] = valor;
  return c;
};

describe('validarLinha', () => {
  it('aceita todas as linhas da amostra', () => {
    for (const linha of LINHAS_AMOSTRA) {
      const r = validarLinha(campos(linha));
      expect(r, linha).toMatchObject({ ok: true });
    }
  });

  it('converte um registro completo', () => {
    const r = validarLinha(campos(LINHAS_AMOSTRA[0] as string));
    expect(r).toEqual({
      ok: true,
      registro: {
        tipoProduto: 'MEDICAMENTO',
        nomeProduto: 'TORVILIP',
        dataFinalizacaoProcesso: '2016-12-19',
        categoriaRegulatoria: 'Similar',
        numeroRegistro: '126750245',
        vencimentoRegistro: '2026-12',
        numeroProcesso: '25351546591201501',
        classeTerapeutica: 'ANTILIPEMICOS',
        empresa: { cnpj: '72593791000111', nome: 'NOVA QUIMICA FARMACÊUTICA S/A' },
        situacaoRegistro: 'Inativo',
        principioAtivo: 'atorvastatina cálcica',
      },
    });
  });

  it('campos vazios viram null, sem inventar valor', () => {
    const r = validarLinha(campos(LINHAS_AMOSTRA[2] as string));
    expect(r).toMatchObject({
      ok: true,
      registro: {
        categoriaRegulatoria: 'BAIXO RISCO',
        numeroRegistro: null,
        vencimentoRegistro: null,
        numeroProcesso: null,
        classeTerapeutica: null,
        principioAtivo: null,
      },
    });
  });

  it('não separa os princípios ativos (isso é da Fase 2)', () => {
    const r = validarLinha(campos(LINHAS_AMOSTRA[4] as string));
    expect(r).toMatchObject({
      registro: { principioAtivo: 'cetoconazol, dipropionato de betametasona' },
    });
  });

  it('o nome da empresa mantém " - " interno e sem CNPJ vira só nome', () => {
    const a = validarLinha(campos(LINHAS_AMOSTRA[2] as string));
    expect(a).toMatchObject({
      registro: {
        empresa: { cnpj: '02817180000124', nome: 'PHYTOLAB INDUSTRIA FARMACEUTICA LTDA - EPP' },
      },
    });
    const b = validarLinha(
      sobrescrever(LINHAS_AMOSTRA[0] as string, 'EMPRESA_DETENTORA_REGISTRO', 'LAB SEM CNPJ'),
    );
    expect(b).toMatchObject({ registro: { empresa: { cnpj: null, nome: 'LAB SEM CNPJ' } } });
  });

  it.each([
    ['DATA_FINALIZACAO_PROCESSO', '31/02/2020', 'não existe'],
    ['DATA_FINALIZACAO_PROCESSO', '2020-02-01', 'DD/MM/AAAA'],
    ['DATA_VENCIMENTO_REGISTRO', '132026', 'MMAAAA'],
    ['DATA_VENCIMENTO_REGISTRO', '12-2026', 'MMAAAA'],
    ['NUMERO_REGISTRO_PRODUTO', '12A45', 'não é numérico'],
    ['NUMERO_PROCESSO', '2535.1/2015', 'não é numérico'],
    ['NOME_PRODUTO', '  ', 'obrigatório'],
    ['SITUACAO_REGISTRO', '', 'obrigatório'],
  ] as const)('rejeita %s = "%s"', (coluna, valor, trecho) => {
    const r = validarLinha(sobrescrever(LINHAS_AMOSTRA[0] as string, coluna, valor));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const motivos = r.motivos.join('|');
      expect(motivos).toContain(`${coluna}: `);
      expect(motivos).toContain(trecho);
    }
  });

  it('acumula todos os motivos de uma linha', () => {
    const c = sobrescrever(LINHAS_AMOSTRA[0] as string, 'NUMERO_REGISTRO_PRODUTO', 'x');
    c[COLUNAS.indexOf('DATA_VENCIMENTO_REGISTRO')] = '99';
    const r = validarLinha(c);
    expect(!r.ok && r.motivos).toHaveLength(2);
  });

  it('rejeita número errado de colunas', () => {
    expect(validarLinha(['a', 'b'])).toEqual({
      ok: false,
      motivos: ['número de colunas: esperado 11, veio 2'],
    });
  });
});

describe('conferirCabecalho', () => {
  it('aceita o cabeçalho esperado e rejeita qualquer mudança', () => {
    expect(conferirCabecalho(CABECALHO.split(';'))).toBeNull();
    expect(conferirCabecalho(CABECALHO.split(';').slice(1))).toContain('cabeçalho inesperado');
    expect(conferirCabecalho([...COLUNAS].reverse())).toContain('cabeçalho inesperado');
  });
});
