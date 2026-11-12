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
    expect(res.relatorio.principioAtivo.todos).toEqual({
      semPrincipioAtivo: 3,
      possivelmenteTruncado: 0,
    });
  });

  it('separa os registros ativos, que são os que limitam a cobertura do app', () => {
    expect(res.relatorio.principioAtivo.ativos).toEqual({
      total: 2,
      semPrincipioAtivo: 1,
      possivelmenteTruncado: 0,
    });
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
    comColuna(b, 5, '"05200"'), // linha 3: válida, vencimento ilegível (aviso)
    'so;tres;colunas', // linha 4: número de colunas
    a, // linha 5: cópia exata da linha 2
    comColuna(c, 4, '"ABC"'), // linha 6: número de registro não numérico
    comColuna(a, 1, '"OUTRO NOME"'), // linha 7: mesmo registro da linha 2, nome diferente
    '"MEDICAMENTO";"CORTADO";"01/01/2020', // linha 8: arquivo cortado, aspas abertas
  ].join('\n');
  const res = processar(entrada(defeituoso));

  it('classifica cada rejeição com linha, categoria e motivo', () => {
    expect(res.rejeicoes.map((r) => [r.linha, r.categoria])).toEqual([
      [4, 'colunas'],
      [6, 'esquema'],
      [8, 'csv-malformado'],
    ]);
    expect(res.rejeicoes[1]?.motivos[0]).toContain('NUMERO_REGISTRO_PRODUTO');
  });

  it('linhas lidas = registros distintos + duplicadas exatas + rejeitadas, sempre', () => {
    const r = res.relatorio;
    expect(r.linhasLidas).toBe(7);
    expect(r.registrosValidos).toBe(3);
    expect(r.duplicadasExatas.total).toBe(1);
    expect(r.rejeitados.total).toBe(3);
    expect(r.linhasLidas).toBe(r.registrosValidos + r.duplicadasExatas.total + r.rejeitados.total);
  });

  it('cópia exata é colapsada e contada à parte: não vira rejeição', () => {
    expect(res.relatorio.duplicadasExatas).toEqual({
      total: 1,
      exemplos: [{ linha: 5, igualALinha: 2 }],
    });
    expect(res.rejeicoes.map((r) => r.linha)).not.toContain(5);
  });

  it('resume rejeições por categoria e por coluna', () => {
    expect(res.relatorio.rejeitados.porCategoria).toEqual({
      esquema: 1,
      'csv-malformado': 1,
      colunas: 1,
    });
    expect(res.relatorio.rejeitados.porColuna).toEqual({ NUMERO_REGISTRO_PRODUTO: 1 });
  });

  it('a amostra de rejeições traz até 10 de cada categoria, na ordem das linhas', () => {
    expect(res.relatorio.rejeitados.amostra.map((x) => [x.categoria, x.linha])).toEqual([
      ['csv-malformado', 8],
      ['colunas', 4],
      ['esquema', 6],
    ]);
  });

  it('vencimento ilegível mantém o registro com o campo vazio e registra o aviso', () => {
    const registro = res.registros.find((r) => r.proveniencia.linha === 3);
    expect(registro).toMatchObject({ nomeProduto: 'TRESIBA', vencimentoRegistro: null });
    expect(res.avisos).toEqual([
      {
        linha: 3,
        coluna: 'DATA_VENCIMENTO_REGISTRO',
        valor: '05200',
        motivo: expect.stringContaining('MMAAAA'),
      },
    ]);
    expect(res.relatorio.avisos).toMatchObject({
      total: 1,
      porColuna: { DATA_VENCIMENTO_REGISTRO: 1 },
      porPadrao: { 'DATA_VENCIMENTO_REGISTRO: NNNNN': 1 },
    });
  });

  it('mantém e explica registros distintos com o mesmo número de registro', () => {
    expect(res.relatorio.mesmoNumeroRegistro).toEqual({
      numerosRepetidos: 1,
      registrosEnvolvidos: 2,
      porCamposDiferentes: { nomeProduto: 1 },
      exemplos: [
        {
          numeroRegistro: '126750245',
          linhas: [2, 7],
          diferencas: { nomeProduto: ['TORVILIP', 'OUTRO NOME'] },
        },
      ],
    });
    expect(res.registros.map((r) => r.proveniencia.linha)).toEqual([2, 3, 7]);
  });
});

describe('processar: princípio ativo cortado', () => {
  it('sinaliza valores com o tamanho do corte sem alterá-los', () => {
    const longo = 'a'.repeat(LIMITE_PRINCIPIO_ATIVO);
    const res = processar(
      entrada(csvAmostra([comColuna(LINHAS_AMOSTRA[0] as string, 10, `"${longo}"`)])),
    );
    expect(res.relatorio.principioAtivo.todos.possivelmenteTruncado).toBe(1);
    expect(res.registros[0]?.principioAtivo).toBe(longo);
  });

  it('conta o corte entre os ativos separadamente', () => {
    const longo = 'a'.repeat(LIMITE_PRINCIPIO_ATIVO);
    const res = processar(
      entrada(csvAmostra([comColuna(LINHAS_AMOSTRA[1] as string, 10, `"${longo}"`)])),
    );
    expect(res.relatorio.principioAtivo.ativos).toMatchObject({
      total: 1,
      possivelmenteTruncado: 1,
    });
  });
});

describe('processar: suspeita de perda de caractere', () => {
  it('conta valores com "?" ou caractere de substituição, por coluna, sem corrigi-los', () => {
    const res = processar(
      entrada(
        csvAmostra([
          comColuna(LINHAS_AMOSTRA[0] as string, 3, '"FITOTER?PICO"'),
          comColuna(LINHAS_AMOSTRA[1] as string, 10, '"insulina deg?deca"'),
          LINHAS_AMOSTRA[4] as string,
        ]),
      ),
    );
    expect(res.relatorio.suspeitaPerdaDeCaractere).toEqual({
      NOME_PRODUTO: 0,
      CATEGORIA_REGULATORIA: 1,
      CLASSE_TERAPEUTICA: 0,
      PRINCIPIO_ATIVO: 1,
    });
    expect(res.registros[0]?.categoriaRegulatoria).toBe('FITOTER?PICO');
  });

  it('reconhece o caractere de substituição U+FFFD em arquivo UTF-8', () => {
    const linha = comColuna(LINHAS_AMOSTRA[0] as string, 10, '"atorvastatina c�lcica"');
    const bytes = new TextEncoder().encode(csvAmostra([linha]));
    const res = processar({ ...entrada(''), bytes });
    expect(res.relatorio.codificacao).toBe('utf-8');
    expect(res.relatorio.suspeitaPerdaDeCaractere.PRINCIPIO_ATIVO).toBe(1);
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
      'avisos.jsonl',
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
    expect(saida['avisos.jsonl']).toBe('');
    expect(saida['relatorio-qualidade.md']).toContain('# Relatório de qualidade');
    expect(saida['relatorio-qualidade.md']).toContain('Nenhuma linha rejeitada.');
    expect(saida['relatorio-qualidade.md']).toContain('Nenhum aviso.');
    expect(JSON.parse(saida['relatorio-qualidade.json'] as string)).toMatchObject({
      registrosValidos: LINHAS_AMOSTRA.length,
    });
  });
});

describe('relatório em Markdown de um arquivo com defeitos', () => {
  const [a, b] = LINHAS_AMOSTRA as [string, string];
  const texto = csvAmostra([
    a,
    comColuna(b, 5, '"a|b"'),
    a,
    comColuna(a, 1, '"OUTRO NOME"'),
    'so;duas',
  ]);
  const saida = serializar(processar(entrada(texto)));
  const md = saida['relatorio-qualidade.md'] as string;

  it('mostra o resumo com as três parcelas e explica a duplicada', () => {
    expect(md).toContain('| 5 | 3 | 1 | 1 |');
    expect(md).toContain('Duplicada exata é cópia idêntica de outra linha');
  });

  it('lista o que muda entre registros de mesmo número', () => {
    expect(md).toContain('### O que muda entre os registros de mesmo número');
    expect(md).toContain('nomeProduto: TORVILIP ↔ OUTRO NOME');
  });

  it('mostra os avisos, escapando "|" para não quebrar a tabela', () => {
    expect(md).toContain('`a\\|b`');
    expect(saida['avisos.jsonl']?.trimEnd().split('\n')).toHaveLength(1);
  });

  it('o arquivo de rejeições não traz as cópias exatas', () => {
    expect(saida['rejeicoes.jsonl']?.trimEnd().split('\n')).toHaveLength(1);
  });
});
