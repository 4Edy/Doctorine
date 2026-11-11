import { describe, expect, it } from 'vitest';
import {
  arquivo,
  conjuntoEstritoValido,
  parAlimento,
  parDoenca,
  parMedicamento,
  parSemInteracao,
} from './fixtures.js';
import { normalizarNome, validar } from './validate.js';

const mensagens = (entrada: unknown, estrito = false) =>
  validar(entrada, { estrito })
    .problemas.map((p) => `${p.caminho}: ${p.mensagem}`)
    .join('\n');

describe('normalizarNome', () => {
  it('ignora acentos, caixa e espaços repetidos', () => {
    expect(normalizarNome('  Ácido   Acetilsalicílico ')).toBe('acido acetilsalicilico');
  });
});

describe('esquema do arquivo', () => {
  it('aceita um arquivo vazio no modo normal', () => {
    const r = validar(arquivo([]));
    expect(r.ok).toBe(true);
    expect(r.resumo?.total).toBe(0);
  });

  it('aceita um par completo de cada tipo', () => {
    const r = validar(
      arquivo([
        parMedicamento(1),
        parSemInteracao(2),
        parAlimento(3),
        parDoenca(4),
        parMedicamento(5, { tipo: 'duplicidade', esperado: { ocorrencia: true } }),
      ]),
    );
    expect(r.problemas).toEqual([]);
    expect(r.resumo?.porTipo['medicamento-alimento']).toBe(1);
  });

  it('rejeita versão desconhecida e campos extras', () => {
    expect(validar({ versao: 2, pares: [] }).ok).toBe(false);
    expect(validar({ versao: 1, pares: [], extra: true }).ok).toBe(false);
    expect(validar(arquivo([parMedicamento(1, { gravide: 'grave' })])).ok).toBe(false);
  });

  it('rejeita entradas que não são objetos', () => {
    expect(validar(null).ok).toBe(false);
    expect(validar([]).ok).toBe(false);
  });

  it('rejeita id fora do padrão', () => {
    expect(mensagens(arquivo([parMedicamento(1, { id: 'Par 1' })]))).toContain('pares.0.id');
  });

  it('rejeita datas inexistentes', () => {
    const par = parMedicamento(1, {
      fonte: { nome: 'Fonte', referencia: 'https://exemplo.invalid', consultadoEm: '2026-02-30' },
    });
    expect(mensagens(arquivo([par]))).toContain('pares.0.fonte.consultadoEm');
  });

  it('rejeita código ATC inválido e aceita um válido', () => {
    const atc = (valor: string) =>
      parMedicamento(1, { a: { tipo: 'principio_ativo', nome: 'Substância Teste', atc: valor } });
    expect(validar(arquivo([atc('N02BE01')])).ok).toBe(true);
    expect(validar(arquivo([atc('n02be01')])).ok).toBe(false);
  });

  it('rejeita gravidade fora da lista', () => {
    const par = parMedicamento(1, { esperado: { ocorrencia: true, gravidade: 'altissima' } });
    expect(validar(arquivo([par])).ok).toBe(false);
  });
});

describe('regras por tipo de par', () => {
  it('exige alimento como segundo item em "medicamento-alimento"', () => {
    const par = parAlimento(1, { b: { tipo: 'doenca', nome: 'Doença Teste' } });
    expect(mensagens(arquivo([par]))).toContain('pares.0.b.tipo');
  });

  it('exige doença como segundo item em "medicamento-doenca"', () => {
    const par = parDoenca(1, { b: { tipo: 'principio_ativo', nome: 'Substância Teste' } });
    expect(mensagens(arquivo([par]))).toContain('pares.0.b.tipo');
  });

  it('exige que o primeiro item seja princípio ativo', () => {
    const par = parMedicamento(1, { a: { tipo: 'alimento', nome: 'Alimento Teste' } });
    expect(mensagens(arquivo([par]))).toContain('pares.0.a.tipo');
  });

  it('"sem-interacao" não aceita ocorrência nem gravidade', () => {
    const com = parSemInteracao(1, { esperado: { ocorrencia: true } });
    const grav = parSemInteracao(2, { esperado: { ocorrencia: false, gravidade: 'leve' } });
    expect(mensagens(arquivo([com]))).toContain('ocorrencia');
    expect(mensagens(arquivo([grav]))).toContain('gravidade');
  });

  it('tipos com interação exigem ocorrência verdadeira e gravidade', () => {
    const sem = parMedicamento(1, { esperado: { ocorrencia: false } });
    const semGrav = parMedicamento(2, { esperado: { ocorrencia: true } });
    expect(mensagens(arquivo([sem]))).toContain('sem-interacao');
    expect(mensagens(arquivo([semGrav]))).toContain('exige gravidade');
  });

  it('duplicidade não exige gravidade', () => {
    const par = parMedicamento(1, { tipo: 'duplicidade', esperado: { ocorrencia: true } });
    expect(validar(arquivo([par])).ok).toBe(true);
  });
});

describe('consistência entre pares', () => {
  it('rejeita ids repetidos', () => {
    const r = mensagens(arquivo([parMedicamento(1), parMedicamento(2, { id: 'par-1' })]));
    expect(r).toContain('repetido');
  });

  it('rejeita o mesmo par em ordem trocada, com acentos e caixa diferentes', () => {
    const a = parMedicamento(1, {
      a: { tipo: 'principio_ativo', nome: 'Ácido Teste' },
      b: { tipo: 'principio_ativo', nome: 'Base Teste' },
    });
    const b = parMedicamento(2, {
      a: { tipo: 'principio_ativo', nome: 'base teste' },
      b: { tipo: 'principio_ativo', nome: 'ACIDO TESTE' },
    });
    expect(mensagens(arquivo([a, b]))).toContain('par repetido');
  });

  it('aceita os mesmos itens em tipos diferentes quando não se contradizem', () => {
    const a = parMedicamento(1);
    const b = parMedicamento(2, {
      tipo: 'duplicidade',
      a: (a as { a: unknown }).a,
      b: (a as { b: unknown }).b,
      esperado: { ocorrencia: true },
    });
    expect(validar(arquivo([a, b])).ok).toBe(true);
  });

  it('rejeita "sem-interacao" que contradiz "medicamento-medicamento"', () => {
    const interacao = parMedicamento(1);
    const ausencia = parSemInteracao(2, {
      a: (interacao as { b: unknown }).b,
      b: (interacao as { a: unknown }).a,
    });
    expect(mensagens(arquivo([interacao, ausencia]))).toContain('contradiz');
  });
});

describe('modo estrito (critério de conclusão da Fase 0)', () => {
  it('aceita 30 pares revisados com a cobertura exigida', () => {
    const r = validar(arquivo(conjuntoEstritoValido()), { estrito: true });
    expect(r.problemas).toEqual([]);
    expect(r.resumo).toMatchObject({ total: 30, revisados: 30, pendentes: 0 });
  });

  it('o arquivo vazio passa no normal e falha no estrito', () => {
    expect(validar(arquivo([])).ok).toBe(true);
    expect(mensagens(arquivo([]), true)).toContain('pelo menos 30 pares');
  });

  it('falha com menos de 30 pares', () => {
    const pares = conjuntoEstritoValido().slice(0, 29);
    expect(mensagens(arquivo(pares), true)).toContain('pelo menos 30 pares (tem 29)');
  });

  it('falha quando algum par não foi revisado', () => {
    const pares = conjuntoEstritoValido();
    pares[3] = parMedicamento(4, { revisao: null });
    expect(mensagens(arquivo(pares), true)).toContain('ainda não foi revisado');
  });

  it('passa no modo normal com pares pendentes', () => {
    const r = validar(arquivo([parMedicamento(1, { revisao: null })]));
    expect(r.ok).toBe(true);
    expect(r.resumo?.pendentes).toBe(1);
  });

  it.each([
    ['sem-interacao', 28, 'sem interação'],
    ['medicamento-alimento', 29, 'com alimento'],
    ['medicamento-doenca', 30, 'com doença'],
  ])('falha sem nenhum par do tipo %s', (_tipo, n, trecho) => {
    const pares = conjuntoEstritoValido();
    pares[n - 1] = parMedicamento(n);
    expect(mensagens(arquivo(pares), true)).toContain(trecho);
  });
});
