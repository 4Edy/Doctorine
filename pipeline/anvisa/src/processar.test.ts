import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CABECALHO, LINHAS_AMOSTRA, csvAmostra, emLatin1 } from './fixtures.js';
import {
  ErroArquivo,
  LIMITE_PRINCIPIO_ATIVO,
  processar,
  type EntradaArquivo,
} from './processar.js';
import { serializar } from './saida.js';

const entrada = (texto: string, sobre: Partial<EntradaArquivo> = {}): EntradaArquivo => ({
  bytes: emLatin1(texto),
  arquivo: 'DADOS_ABERTOS_MEDICAMENTOS.csv',
  baixadoEm: '2026-11-11',
  url: 'https://exemplo.invalid/arquivo.csv',
  ...sobre,
});

/** Troca o valor de uma coluna (0 = TIPO_PRODUTO ... 10 = PRINCIPIO_ATIVO) numa linha da amostra. */
const comColuna = (linha: string, indice: number, valor: string): string => {
  const campos = linha.split(';');
  campos[indice] = valor;
  return campos.join(';');
};

describe('processar: arquivo válido', () => {
  const res = processar(entrada(csvAmostra()));

  it('lê todas as linhas, com acentos corretos vindos de Windows-1252', () => {
    expect(res.relatorio.codificacao).toBe('windows-1252');
    expect(res.relatorio.linhasLidas).toBe(LINHAS_AMOSTRA.length);
    expect(res.relatorio.registrosValidos).toBe(LINHAS_AMOSTRA.length);
    expect(res.rejeicoes).toEqual([]);
    expect(res.registros.map((r) => r.nomeProduto)).toContain('ÁGUA PARA INJEÇÃO');
  });

  it('grava a proveniência em todo registro: fonte, versão, data e linha', () => {
    const sha = createHash('sha256').update(emLatin1(csvAmostra())).digest('hex');
    expect(res.relatorio.fonte.sha256).toBe(sha);
    res.registros.forEach((r, i) => {
      expect(r.proveniencia).toEqual({
        fonte: 'anvisa-dados-abertos-medicamentos',
        versao: sha.slice(0, 12),
        data: '2026-11-11',
        linha: i + 2,
      });
    });
  });

  it('conta vazios e registros sem princípio ativo', () => {
    expect(res.relatorio.nulosPorColuna.NUMERO_REGISTRO_PRODUTO).toBe(2);
    expect(res.relatorio.nulosPorColuna.CATEGORIA_REGULATORIA).toBe(1);
    expect(res.relatorio.principioAtivo.semPrincipioAtivo).toBe(3);
    expect(res.relatorio.principioAtivo.possivelmenteTruncado).toBe(0);
  });

  it('as distribuições saem ordenadas do mais para o menos frequente', () => {
    expect(res.relatorio.distribuicoes.situacaoRegistro).toEqual({ Inativo: 6, Ativo: 2 });
    expect(Object.keys(res.relatorio.distribuicoes.situacaoRegistro)).toEqual(['Inativo', 'Ativo']);
    expect(res.relatorio.distribuicoes.categoriaRegulatoria).toMatchObject({ Similar: 3 });
  });
});

describe('processar: arquivo com defeitos', () => {
  const [a, b, c] = LINHAS_AMOSTRA as [string, string, string];
  const defeituoso = [
    CABECALHO,
    a, // linha 2: válida
    comColuna(b, 2, '"31/02/2020"'), // linha 3: data inexistente
    'so;tres;colunas', // linha 4: número de colunas
    a, // linha 5: duplicata exata da linha 2
    comColuna(c, 4, '"ABC"') + '', // linha 6: registro não numérico
    comColuna(a, 1, '"OUTRO NOME"'), // linha 7: mesmo registro da linha 2, nome diferente
    '"MEDICAMENTO";"CORTADO";"01/01/2020', // linha 8: arquivo cortado, aspas abertas
  ].join('\n');
  const res = processar(entrada(defeituoso));

  it('classifica cada rejeição com linha, categoria e motivo', () => {
    expect(res.rejeicoes.map((r) => [r.linha, r.categoria])).toEqual([
      [3, 'esquema'],
      [4, 'colunas'],
      [5, 'duplicada-exata'],
      [6, 'esquema'],
      [8, 'csv-malformado'],
    ]);
    expect(res.rejeicoes[0]?.motivos[0]).toContain('DATA_FINALIZACAO_PROCESSO');
    expect(res.rejeicoes[2]?.motivos).toEqual(['idêntica à linha 2']);
  });

  it('linhas lidas = válidas + rejeitadas, sempre', () => {
    const r = res.relatorio;
    expect(r.linhasLidas).toBe(7);
    expect(r.registrosValidos).toBe(2);
    expect(r.rejeitados.total).toBe(5);
    expect(r.linhasLidas).toBe(r.registrosValidos + r.rejeitados.total);
    expect(r.duplicados.exatas).toBe(1);
  });

  it('resume rejeições por categoria e por coluna', () => {
    expect(res.relatorio.rejeitados.porCategoria).toEqual({
      esquema: 2,
      'csv-malformado': 1,
      colunas: 1,
      'duplicada-exata': 1,
    });
    expect(res.relatorio.rejeitados.porColuna).toEqual({
      DATA_FINALIZACAO_PROCESSO: 1,
      NUMERO_REGISTRO_PRODUTO: 1,
    });
  });

  it('mantém e reporta registros distintos com o mesmo número de registro', () => {
    expect(res.relatorio.duplicados.mesmoNumeroRegistro).toEqual({
      numerosRepetidos: 1,
      registrosEnvolvidos: 2,
      exemplos: [{ numeroRegistro: '126750245', linhas: [2, 7] }],
    });
    expect(res.registros.map((r) => r.proveniencia.linha)).toEqual([2, 7]);
  });
});

describe('processar: princípio ativo cortado', () => {
  it('sinaliza valores com o tamanho do corte sem alterá-los', () => {
    const longo = 'a'.repeat(LIMITE_PRINCIPIO_ATIVO);
    const res = processar(
      entrada(csvAmostra([comColuna(LINHAS_AMOSTRA[0] as string, 10, `"${longo}"`)])),
    );
    expect(res.relatorio.principioAtivo.possivelmenteTruncado).toBe(1);
    expect(res.registros[0]?.principioAtivo).toBe(longo);
  });
});

describe('processar: falhas do arquivo inteiro', () => {
  it('rejeita arquivo vazio', () => {
    expect(() => processar(entrada(''))).toThrow(ErroArquivo);
  });

  it('rejeita cabeçalho diferente do esperado', () => {
    const outro = csvAmostra().replace('NOME_PRODUTO', 'NOME');
    expect(() => processar(entrada(outro))).toThrow(/cabeçalho inesperado/);
  });
});

describe('processar: idempotência', () => {
  it('duas execuções sobre os mesmos bytes geram saídas idênticas, byte a byte', () => {
    const texto = csvAmostra([...LINHAS_AMOSTRA, LINHAS_AMOSTRA[0] as string, 'so;duas']);
    const primeira = serializar(processar(entrada(texto)));
    const segunda = serializar(processar(entrada(texto)));
    expect(Object.keys(primeira)).toEqual([
      'registros.jsonl',
      'rejeicoes.jsonl',
      'relatorio-qualidade.json',
      'relatorio-qualidade.md',
    ]);
    expect(segunda).toEqual(primeira);
  });

  it('mudar um único byte do arquivo muda a versão', () => {
    const a = processar(entrada(csvAmostra())).relatorio.fonte.versao;
    const b = processar(entrada(csvAmostra().replace('TRESIBA', 'TRESIBB'))).relatorio.fonte.versao;
    expect(a).not.toBe(b);
  });
});

describe('serializar', () => {
  it('gera JSONL com um registro por linha e relatório em Markdown legível', () => {
    const saida = serializar(processar(entrada(csvAmostra())));
    expect(saida['registros.jsonl']?.trimEnd().split('\n')).toHaveLength(LINHAS_AMOSTRA.length);
    expect(saida['rejeicoes.jsonl']).toBe('');
    expect(saida['relatorio-qualidade.md']).toContain('# Relatório de qualidade');
    expect(saida['relatorio-qualidade.md']).toContain('Nenhuma linha rejeitada.');
    expect(JSON.parse(saida['relatorio-qualidade.json'] as string)).toMatchObject({
      registrosValidos: LINHAS_AMOSTRA.length,
    });
  });
});
