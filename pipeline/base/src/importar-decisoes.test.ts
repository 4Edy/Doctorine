import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mapear, validarDecisoes } from '@doctorine/mapeamento';
import { ARQUIVOS_MAPEAMENTO, csv, escreverArquivosDoMapeamento } from './arquivos-mapeamento.js';
import { decisoesDoCsv, executar, juntarDecisoes, lerCsv } from './importar-decisoes.js';

const FARMACOS = [
  { id: 4, nomeEn: 'Acetaminophen' },
  { id: 5, nomeEn: 'Phenytoin' },
  { id: 9, nomeEn: 'Metamizole' },
];
const MEDS = [
  { id: 1, nome: 'TYLENOL', ativo: true, principioAtivoOriginal: 'paracetamol' },
  { id: 2, nome: 'HIDANTAL', ativo: true, principioAtivoOriginal: 'fenitoína' },
  { id: 3, nome: 'NOVALGINA', ativo: true, principioAtivoOriginal: 'dipirona monoidratada' },
  { id: 4, nome: 'OUTRO', ativo: true, principioAtivoOriginal: 'acetaminofeno' },
  { id: 5, nome: 'VASELINA', ativo: true, principioAtivoOriginal: 'vaselina líquida' },
];
const o = { revisadoPor: 'Farmacêutica', revisadoEm: '2026-11-20', existentes: new Set<string>() };

/** Fila real, gerada pelo mesmo código que a CLI usa, para preencher como a farmacêutica faria. */
function filaGerada(pasta: string): string[][] {
  escreverArquivosDoMapeamento(
    pasta,
    mapear({ medicamentos: MEDS, farmacos: FARMACOS, decisoes: [] }),
  );
  return lerCsv(readFileSync(join(pasta, ARQUIVOS_MAPEAMENTO.fila), 'utf8'));
}
const preencher = (
  linhas: string[][],
  chave: string,
  valores: Record<string, string>,
): string[][] => {
  const cab = (linhas[0] as string[]).map((c) => c.replace(/\s*\(.*$/, ''));
  return linhas.map((l, i) => {
    if (i === 0 || l[cab.indexOf('chave')] !== chave) return l;
    const nova = [...l];
    for (const [k, v] of Object.entries(valores)) nova[cab.indexOf(k)] = v;
    return nova;
  });
};
const comoCsv = (linhas: string[][]): string => csv(linhas[0] as string[], linhas.slice(1));

describe('lerCsv', () => {
  it('lê BOM, CRLF, aspas e ; ou , como separador', () => {
    expect(lerCsv('﻿a;b\r\n"x;y";"diz ""oi"""\r\n')).toEqual([
      ['a', 'b'],
      ['x;y', 'diz "oi"'],
    ]);
    expect(lerCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
  it('guarda quebra de linha dentro de aspas e ignora linhas vazias', () => {
    expect(lerCsv('a;b\n"x\ny";2\n;\n')).toEqual([
      ['a', 'b'],
      ['x\ny', '2'],
    ]);
  });
});

describe('decisoesDoCsv', () => {
  const cab = 'chave;acao;ddinter_ids;como_chave;nome_pt;observacao;candidato_1 (id · nome)';
  const le = (...linhas: string[]) => decisoesDoCsv([cab, ...linhas].join('\n'), o);

  it('converte as três ações e ignora linhas sem ação', () => {
    const r = le(
      'paracetamol;equivale;4;;paracetamol;;',
      'ezetimiba;sem-equivalente;;;;não consta;',
      'acetaminofeno;mesmo-que;;paracetamol;;;',
      'outra;;;;;;',
    );
    expect(r.erros).toEqual([]);
    expect(r.semAcao).toBe(1);
    expect(r.novas).toEqual([
      {
        chave: 'paracetamol',
        acao: 'equivale',
        ddinterIds: [4],
        nomePt: 'paracetamol',
        revisadoPor: 'Farmacêutica',
        revisadoEm: '2026-11-20',
      },
      {
        chave: 'ezetimiba',
        acao: 'sem-equivalente',
        motivo: 'não consta',
        revisadoPor: 'Farmacêutica',
        revisadoEm: '2026-11-20',
      },
      {
        chave: 'acetaminofeno',
        acao: 'mesmo-que',
        comoChave: 'paracetamol',
        revisadoPor: 'Farmacêutica',
        revisadoEm: '2026-11-20',
      },
    ]);
  });

  it('aceita vários ids e c1/c2/c3 como atalho para o candidato da linha', () => {
    const r = le('a;equivale;4|5;;;;', 'b;equivale;c1;;;;"1162 · Acetaminophen · 1 · sinônimo"');
    expect(r.erros).toEqual([]);
    expect(r.novas.map((d) => d.acao === 'equivale' && d.ddinterIds)).toEqual([[4, 5], [1162]]);
  });

  it.each([
    ['ação desconhecida', 'a;talvez;;;;;', /ação "talvez"/],
    ['equivale sem id', 'a;equivale;;;;;', /precisa de ddinter_ids/],
    ['id colado com o nome', 'a;equivale;1162 · Metaraminol;;;;', /não é um número/],
    ['c2 sem candidato', 'a;equivale;c2;;;;', /não tem candidato 2/],
    ['mesmo-que sem alvo', 'a;mesmo-que;;;;;', /precisa de como_chave/],
    ['chave alterada', 'Paracetamol;equivale;4;;;;', /chave fora do formato/],
  ])('recusa: %s', (_n, linha, motivo) => {
    const r = le(linha);
    expect(r.novas).toEqual([]);
    expect(r.erros[0]).toMatch(motivo);
    expect(r.erros[0]).toMatch(/^linha 2/);
  });

  it('recusa chave já decidida e chave repetida no CSV', () => {
    expect(
      decisoesDoCsv([cab, 'a;sem-equivalente;;;;;'].join('\n'), {
        ...o,
        existentes: new Set(['a']),
      }).erros[0],
    ).toMatch(/já existe decisão/);
    expect(le('a;sem-equivalente;;;;;', 'a;sem-equivalente;;;;;').erros[0]).toMatch(/repetida/);
  });

  it('CSV sem as colunas chave e acao é recusado', () => {
    expect(decisoesDoCsv('x;y\n1;2', o).erros[0]).toMatch(/colunas "chave" e "acao"/);
  });
});

describe('juntarDecisoes', () => {
  it('ordena por chave, atualiza a data e valida o arquivo todo', () => {
    const r = decisoesDoCsv('chave;acao\nb;sem-equivalente\na;sem-equivalente', o);
    const j = juntarDecisoes(
      { versao: 1, atualizadoEm: '2026-01-01', decisoes: [] },
      r.novas,
      '2026-11-20',
    );
    expect(j.decisoes.map((d) => d.chave)).toEqual(['a', 'b']);
    expect(j.atualizadoEm).toBe('2026-11-20');
    expect(validarDecisoes(j).ok).toBe(true);
  });
});

describe('CLI de importação (ida e volta com a fila real)', () => {
  let pasta: string;
  let saida: ReturnType<typeof vi.spyOn>;
  let erro: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    pasta = mkdtempSync(join(tmpdir(), 'doctorine-decisoes-'));
    mkdirSync(join(pasta, 'data', 'mapeamento'), { recursive: true });
    saida = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    erro = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    saida.mockRestore();
    erro.mockRestore();
    rmSync(pasta, { recursive: true, force: true });
  });
  const arquivo = (): string => join(pasta, 'data', 'mapeamento', 'decisoes.json');

  it('a fila preenchida vira decisões que resolvem os pendentes na carga seguinte', () => {
    let linhas = filaGerada(pasta);
    // paracetamol tem o sinônimo Acetaminophen como candidato 1; dipirona, Metamizole
    linhas = preencher(linhas, 'paracetamol', {
      acao: 'equivale',
      ddinter_ids: 'c1',
      nome_pt: 'paracetamol',
    });
    linhas = preencher(linhas, 'dipirona monoidratada', {
      acao: 'equivale',
      ddinter_ids: 'c1',
      nome_pt: 'dipirona',
    });
    linhas = preencher(linhas, 'acetaminofeno', { acao: 'mesmo-que', como_chave: 'paracetamol' });
    linhas = preencher(linhas, 'vaselina liquida', {
      acao: 'sem-equivalente',
      observacao: 'excipiente',
    });
    const csvPath = join(pasta, 'preenchida.csv');
    writeFileSync(csvPath, comoCsv(linhas), 'utf8');

    expect(
      executar([csvPath, '--raiz', pasta, '--revisor', 'Dra. Fulana', '--data', '2026-11-20']),
    ).toBe(0);
    const lido = validarDecisoes(JSON.parse(readFileSync(arquivo(), 'utf8')));
    expect(lido.ok).toBe(true);
    if (!lido.ok) return;
    expect(lido.dados.atualizadoEm).toBe('2026-11-20');
    expect(lido.dados.decisoes.map((d) => [d.chave, d.acao, d.revisadoPor])).toEqual([
      ['acetaminofeno', 'mesmo-que', 'Dra. Fulana'],
      ['dipirona monoidratada', 'equivale', 'Dra. Fulana'],
      ['paracetamol', 'equivale', 'Dra. Fulana'],
      ['vaselina liquida', 'sem-equivalente', 'Dra. Fulana'],
    ]);

    const depois = mapear({
      medicamentos: MEDS,
      farmacos: FARMACOS,
      decisoes: lido.dados.decisoes,
    });
    expect(depois.fila.map((f) => f.chave)).toEqual(['fenitoina']);
    expect(depois.cobertura.ativos.completos).toBe(4);
    expect(depois.principios.find((p) => p.ddinterIds.includes(4))?.nomePt).toBe('paracetamol');
    // e o que sobrou ainda traz o candidato certo
    expect(depois.fila[0]?.candidatos[0]).toMatchObject({ id: 5, nome: 'Phenytoin' });
  });

  it('se houver qualquer erro, nada é gravado', () => {
    let linhas = filaGerada(pasta);
    linhas = preencher(linhas, 'paracetamol', { acao: 'equivale', ddinter_ids: 'c1' });
    linhas = preencher(linhas, 'fenitoina', { acao: 'equivale', ddinter_ids: 'não sei' });
    const csvPath = join(pasta, 'p.csv');
    writeFileSync(csvPath, comoCsv(linhas), 'utf8');
    expect(executar([csvPath, '--raiz', pasta, '--revisor', 'Dra. Fulana'])).toBe(1);
    expect(existsSync(arquivo())).toBe(false);
  });

  it('--simular confere sem gravar; sem --revisor ou sem arquivo, falha', () => {
    let linhas = filaGerada(pasta);
    linhas = preencher(linhas, 'paracetamol', { acao: 'equivale', ddinter_ids: 'c1' });
    const csvPath = join(pasta, 'p.csv');
    writeFileSync(csvPath, comoCsv(linhas), 'utf8');
    expect(executar([csvPath, '--raiz', pasta, '--revisor', 'Dra. Fulana', '--simular'])).toBe(0);
    expect(existsSync(arquivo())).toBe(false);
    expect(executar([csvPath, '--raiz', pasta])).toBe(1);
    expect(executar([join(pasta, 'nao-existe.csv'), '--raiz', pasta, '--revisor', 'Fulana'])).toBe(
      1,
    );
  });

  it('importar de novo acrescenta, mantendo as decisões anteriores', () => {
    let linhas = filaGerada(pasta);
    const caminho = join(pasta, 'p1.csv');
    writeFileSync(
      caminho,
      comoCsv(preencher(linhas, 'paracetamol', { acao: 'equivale', ddinter_ids: 'c1' })),
      'utf8',
    );
    expect(
      executar([caminho, '--raiz', pasta, '--revisor', 'Dra. Fulana', '--data', '2026-11-20']),
    ).toBe(0);
    linhas = filaGerada(pasta);
    const caminho2 = join(pasta, 'p2.csv');
    writeFileSync(
      caminho2,
      comoCsv(preencher(linhas, 'fenitoina', { acao: 'equivale', ddinter_ids: 'c1' })),
      'utf8',
    );
    expect(
      executar([caminho2, '--raiz', pasta, '--revisor', 'Dra. Fulana', '--data', '2026-11-21']),
    ).toBe(0);
    const r = validarDecisoes(JSON.parse(readFileSync(arquivo(), 'utf8')));
    expect(r.ok && r.dados.decisoes.map((d) => d.chave)).toEqual(['fenitoina', 'paracetamol']);
    expect(r.ok && r.dados.atualizadoEm).toBe('2026-11-21');
  });
});
