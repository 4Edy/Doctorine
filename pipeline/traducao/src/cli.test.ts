import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executar } from './cli.js';
import { criarProcessado } from './fixtures.js';
import { Memoria } from './memoria.js';

const real = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
  '..',
  '..',
  'data',
  'traducao',
  'glossario.json',
);

let raiz: string;
let saida: string[];
beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), 'cli-'));
  criarProcessado(raiz);
  mkdirSync(join(raiz, 'data', 'traducao'), { recursive: true });
  copyFileSync(real, join(raiz, 'data', 'traducao', 'glossario.json'));
  saida = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => void saida.push(a.join(' ')));
});
afterEach(() => vi.restoreAllMocks());
const rodar = (...a: string[]) => executar([...a, '--raiz', raiz]);
const texto = () => saida.join('\n');

describe('CLI do P8', () => {
  it('glossario não precisa dos dados', async () => {
    expect(await rodar('glossario')).toBe(0);
    expect(texto()).toMatch(/glossário v1/);
  });
  it('extrair grava as unidades; status conta tudo como sem tradução', async () => {
    expect(await rodar('extrair')).toBe(0);
    expect(texto()).toMatch(/\d+ textos distintos/);
    saida.length = 0;
    expect(await rodar('status')).toBe(0);
    expect(texto()).toMatch(/Interações graves revisadas: 0 de 2/);
  });
  it('exportar → traduzir fora → importar → validar → status, tudo ligado pelo id', async () => {
    await rodar('exportar', '--limite', '50');
    const dir = join(raiz, 'data', 'traducao', 'lotes');
    const [arq] = readdirSync(dir);
    const lote = JSON.parse(readFileSync(join(dir, arq as string), 'utf8')) as {
      itens: Array<{ id: string; en: string }>;
    };
    // os nomes de fármaco saem do lote como marcadores
    expect(lote.itens.some((i) => i.en.includes('[[F1]]'))).toBe(true);
    expect(JSON.stringify(lote)).not.toContain('Warfarin');
    const trad = lote.itens.map((i) => ({
      id: i.id,
      pt: i.en
        .replace(
          'Coadministration of [[F1]] with [[F2]] may increase the risk of angioedema.',
          'A coadministração de [[F1]] com [[F2]] pode aumentar o risco de angioedema.',
        )
        .replace(
          '[[F1]] may cause bleeding when used with other drugs.',
          '[[F1]] pode causar sangramento quando usado com outros medicamentos.',
        ),
    }));
    const resp = join(raiz, 'resposta.json');
    writeFileSync(resp, JSON.stringify({ itens: trad }));
    saida.length = 0;
    // os textos que não foram traduzidos de verdade (ficaram em inglês) passam: só os marcadores importam
    expect(await rodar('importar', resp, '--modelo', 'chat')).toBe(0);
    expect(texto()).toMatch(/gravados: \d+; rejeitados: 0/);
    const mem = new Memoria(join(raiz, 'data', 'traducao', 'memoria.jsonl'));
    expect(mem.tamanho).toBe(lote.itens.length);
    expect([...mem.todos()].every((e) => e.status === 'nao-revisado' && e.modelo === 'chat')).toBe(
      true,
    );
    expect(await rodar('validar')).toBe(0);
    saida.length = 0;
    await rodar('status');
    expect(texto()).toMatch(/Não revisado/);
  });
  it('importar rejeita tradução que perdeu o nome do fármaco e sai com 1', async () => {
    await rodar('exportar', '--limite', '50');
    const dir = join(raiz, 'data', 'traducao', 'lotes');
    const lote = JSON.parse(readFileSync(join(dir, readdirSync(dir)[0] as string), 'utf8')) as {
      itens: Array<{ id: string; en: string }>;
    };
    const alvo = lote.itens.find((i) => i.en.includes('[[F1]]')) as { id: string };
    const resp = join(raiz, 'r.json');
    writeFileSync(resp, JSON.stringify([{ id: alvo.id, pt: 'A varfarina causa sangramento.' }]));
    expect(await rodar('importar', resp)).toBe(1);
    expect(texto()).toMatch(/rejeitados: 1/);
    expect(
      new Memoria(join(raiz, 'data', 'traducao', 'memoria.jsonl')).estado(alvo.id),
    ).toBeUndefined();
  });
  it('validar sai com 1 quando a memória tem tradução com marcador errado', async () => {
    await rodar('exportar', '--limite', '50');
    const dir = join(raiz, 'data', 'traducao', 'lotes');
    const lote = JSON.parse(readFileSync(join(dir, readdirSync(dir)[0] as string), 'utf8')) as {
      itens: Array<{ id: string; en: string }>;
    };
    const alvo = lote.itens.find((i) => i.en.includes('[[F1]]')) as { id: string };
    appendFileSync(
      join(raiz, 'data', 'traducao', 'memoria.jsonl'),
      JSON.stringify({
        id: alvo.id,
        seq: 1,
        pt: 'sem marcador',
        status: 'nao-revisado',
        origem: 'ia',
        modelo: 'x',
        glossario: 'g',
        data: '2026-11-16',
        nota: null,
      }) + '\n',
    );
    expect(await rodar('validar')).toBe(1);
    expect(texto()).toMatch(/erro .*marcadores de fármaco diferem/);
  });
  it('importar resolve caminho relativo a partir da raiz e avisa quando o arquivo não existe', async () => {
    await expect(rodar('importar', 'nao-existe.json')).rejects.toThrow(
      /arquivo não encontrado: .*nao-existe\.json/,
    );
    writeFileSync(join(raiz, 'vazio.json'), '[]');
    const antes = process.cwd();
    process.chdir(tmpdir()); // como o pnpm --filter, que roda numa pasta diferente da raiz
    try {
      expect(await rodar('importar', 'vazio.json')).toBe(0);
    } finally {
      process.chdir(antes);
    }
  });
  it('comparar grava o arquivo com inglês e português lado a lado, com os nomes restaurados', async () => {
    await rodar('exportar', '--limite', '50');
    const dir = join(raiz, 'data', 'traducao', 'lotes');
    const lote = JSON.parse(readFileSync(join(dir, readdirSync(dir)[0] as string), 'utf8')) as {
      itens: Array<{ id: string; en: string }>;
    };
    const alvo = lote.itens.find((i) => i.en.startsWith('[[F1]] may cause bleeding')) as {
      id: string;
    };
    const resp = join(raiz, 'c.json');
    writeFileSync(
      resp,
      JSON.stringify([
        { id: alvo.id, pt: '[[F1]] pode causar sangramento quando usado com outros medicamentos.' },
      ]),
    );
    await rodar('importar', resp);
    expect(await rodar('comparar')).toBe(0);
    const md = readFileSync(join(raiz, 'data', 'traducao', 'comparacao.md'), 'utf8');
    expect(md).toContain('**EN:** Warfarin may cause bleeding');
    expect(md).toContain('**PT:** Warfarin pode causar sangramento');
  });
  it('rascunhar exige a chave da API; comando desconhecido sai com 2', async () => {
    const chave = process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
    await expect(rodar('rascunhar')).rejects.toThrow(/ANTHROPIC_API_KEY/);
    if (chave !== undefined) process.env['ANTHROPIC_API_KEY'] = chave;
    delete process.env['GEMINI_API_KEY'];
    await expect(rodar('rascunhar', '--provedor', 'gemini')).rejects.toThrow(/GEMINI_API_KEY/);
    await expect(rodar('rascunhar', '--provedor', 'xyz')).rejects.toThrow(/--provedor/);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await rodar('xyz')).toBe(2);
  });
});
