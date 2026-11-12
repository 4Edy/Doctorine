import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { baixar, importar, lerManifesto, ultimoDownload } from './baixar.js';
import { conjuntoAmostra } from './fixtures.js';
import { ErroArquivo } from './processar.js';

const dia = (iso: string) => () => new Date(`${iso}T15:00:00Z`);
const BASE = 'https://exemplo.invalid/download';

/** Servidor falso: devolve o arquivo da letra pedida. */
const servidor = (arquivos = conjuntoAmostra(), init: ResponseInit = {}) =>
  (async (url: string | URL | Request) => {
    const letra = /code_([A-Z])\.csv$/.exec(String(url))?.[1];
    const a = arquivos.find((x) => x.letra === letra);
    return a === undefined
      ? new Response('nada', { status: 404 })
      : new Response(a.bytes, { status: 200, ...init });
  }) as typeof fetch;

let pasta: string;
beforeEach(() => {
  pasta = mkdtempSync(join(tmpdir(), 'doctorine-ddinter-'));
});
afterEach(() => {
  rmSync(pasta, { recursive: true, force: true });
});

const gravarConjunto = (dir: string, prefixo = ''): void => {
  mkdirSync(dir, { recursive: true });
  for (const a of conjuntoAmostra()) {
    writeFileSync(join(dir, `${prefixo}ddinter_downloads_code_${a.letra}.csv`), a.bytes);
  }
};

describe('baixar', () => {
  it('grava os 8 arquivos e o manifesto numa pasta nomeada pelo checksum do conjunto', async () => {
    const r = await baixar({
      destino: pasta,
      baseUrl: BASE + '/',
      buscar: servidor(conjuntoAmostra(), { headers: { etag: '"abc"' } }),
      agora: dia('2026-11-12'),
    });
    expect(r.novo).toBe(true);
    expect(r.manifesto).toMatchObject({ origem: 'download', baixadoEm: '2026-11-12' });
    expect(r.manifesto.arquivos.map((a) => a.letra)).toEqual([
      'A',
      'B',
      'D',
      'H',
      'L',
      'P',
      'R',
      'V',
    ]);
    expect(r.manifesto.arquivos[0]).toMatchObject({
      url: `${BASE}/ddinter_downloads_code_A.csv`,
      etag: '"abc"',
    });
    expect(r.diretorio).toBe(join(pasta, r.manifesto.sha256.slice(0, 12)));
    expect(readdirSync(r.diretorio)).toHaveLength(9);
    expect(lerManifesto(r.diretorio)).toEqual(r.manifesto);
  });

  it('baixar o mesmo conteúdo de novo não muda nada', async () => {
    const a = await baixar({
      destino: pasta,
      baseUrl: BASE,
      buscar: servidor(),
      agora: dia('2026-11-12'),
    });
    const b = await baixar({
      destino: pasta,
      baseUrl: BASE,
      buscar: servidor(),
      agora: dia('2026-11-20'),
    });
    expect(b.novo).toBe(false);
    expect(b.diretorio).toBe(a.diretorio);
    expect(b.manifesto.baixadoEm).toBe('2026-11-12');
  });

  it('falha sem gravar nada se um arquivo falhar, vier vazio ou vier HTML', async () => {
    const semV = conjuntoAmostra().filter((a) => a.letra !== 'V');
    await expect(baixar({ destino: pasta, baseUrl: BASE, buscar: servidor(semV) })).rejects.toThrow(
      /HTTP 404/,
    );
    const vazio = conjuntoAmostra().map((a) =>
      a.letra === 'D' ? { ...a, bytes: new Uint8Array() } : a,
    );
    await expect(
      baixar({ destino: pasta, baseUrl: BASE, buscar: servidor(vazio) }),
    ).rejects.toThrow(/vazio/);
    const html = conjuntoAmostra().map((a) =>
      a.letra === 'H' ? { ...a, bytes: Buffer.from('<html>') } : a,
    );
    await expect(baixar({ destino: pasta, baseUrl: BASE, buscar: servidor(html) })).rejects.toThrow(
      /HTML/,
    );
    expect(readdirSync(pasta)).toEqual([]);
  });

  it('explica como importar à mão quando o site não responde', async () => {
    const fora = (async () => {
      throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND') });
    }) as typeof fetch;
    await expect(baixar({ destino: pasta, baseUrl: BASE, buscar: fora })).rejects.toThrow(
      /ENOTFOUND.*importar/,
    );
  });
});

describe('importar', () => {
  it('registra os 8 arquivos da pasta, mesmo com prefixo no nome, como origem "manual"', () => {
    const origem = join(pasta, 'baixados');
    gravarConjunto(origem, '68dedba5-');
    const r = importar({ destino: join(pasta, 'raw'), pasta: origem, agora: dia('2026-11-12') });
    expect(r.novo).toBe(true);
    expect(r.manifesto.origem).toBe('manual');
    expect(r.manifesto.arquivos.every((a) => a.url === null)).toBe(true);
    expect(readdirSync(r.diretorio).sort()[0]).toBe('ddinter_downloads_code_A.csv');
  });

  it('gera a mesma versão que o download do mesmo conteúdo', async () => {
    const origem = join(pasta, 'baixados');
    gravarConjunto(origem);
    const a = importar({ destino: join(pasta, 'raw'), pasta: origem });
    const b = await baixar({ destino: join(pasta, 'raw2'), baseUrl: BASE, buscar: servidor() });
    expect(a.manifesto.sha256).toBe(b.manifesto.sha256);
  });

  it('recusa pasta inexistente, sem arquivos e conjunto incompleto', () => {
    expect(() => importar({ destino: pasta, pasta: join(pasta, 'nao-existe') })).toThrow(
      ErroArquivo,
    );
    mkdirSync(join(pasta, 'vazia'));
    expect(() => importar({ destino: pasta, pasta: join(pasta, 'vazia') })).toThrow(
      /nenhum arquivo/,
    );
    const parcial = join(pasta, 'parcial');
    gravarConjunto(parcial);
    rmSync(join(parcial, 'ddinter_downloads_code_L.csv'));
    expect(() => importar({ destino: join(pasta, 'raw'), pasta: parcial })).toThrow(/faltam \[L\]/);
  });
});

describe('ultimoDownload', () => {
  it('escolhe o mais recente e falha com mensagem útil se não houver nenhum', async () => {
    expect(() => ultimoDownload(pasta)).toThrow(/baixar" ou "importar"/);
    const velho = await baixar({
      destino: pasta,
      baseUrl: BASE,
      buscar: servidor(),
      agora: dia('2026-11-12'),
    });
    const outro = conjuntoAmostra({ V: ['DDInter1,Abacavir,DDInter424,Cobicistat,Major'] });
    const novo = await baixar({
      destino: pasta,
      baseUrl: BASE,
      buscar: servidor(outro),
      agora: dia('2026-11-13'),
    });
    expect(ultimoDownload(pasta).diretorio).toBe(novo.diretorio);
    expect(readFileSync(join(velho.diretorio, 'manifesto.json'), 'utf8')).toContain('2026-11-12');
  });
});
