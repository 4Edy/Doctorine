import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { baixar, lerManifesto, ultimoDownload } from './baixar.js';
import { csvAmostra, emLatin1 } from './fixtures.js';
import { ErroArquivo } from './processar.js';

const URL_TESTE = 'https://exemplo.invalid/dados/DADOS_ABERTOS_MEDICAMENTOS.csv';
const dia = (iso: string) => () => new Date(`${iso}T15:00:00Z`);
const resposta = (corpo: Uint8Array | string, init: ResponseInit = {}) =>
  (async () => new Response(corpo, { status: 200, ...init })) as typeof fetch;

let pasta: string;
beforeEach(() => {
  pasta = mkdtempSync(join(tmpdir(), 'doctorine-anvisa-'));
});
afterEach(() => {
  rmSync(pasta, { recursive: true, force: true });
});

describe('baixar', () => {
  it('grava o arquivo e o manifesto numa pasta nomeada pelo checksum', async () => {
    const bytes = emLatin1(csvAmostra());
    const r = await baixar({
      destino: pasta,
      url: URL_TESTE,
      buscar: resposta(bytes, {
        headers: { 'last-modified': 'Wed, 11 Nov 2026 14:45:00 GMT', etag: '"abc"' },
      }),
      agora: dia('2026-11-11'),
    });
    expect(r.novo).toBe(true);
    expect(r.manifesto).toMatchObject({
      fonte: 'anvisa-dados-abertos-medicamentos',
      arquivo: 'DADOS_ABERTOS_MEDICAMENTOS.csv',
      url: URL_TESTE,
      baixadoEm: '2026-11-11',
      bytes: bytes.byteLength,
      ultimaModificacao: 'Wed, 11 Nov 2026 14:45:00 GMT',
      etag: '"abc"',
    });
    expect(r.diretorio).toBe(join(pasta, r.manifesto.sha256.slice(0, 12)));
    expect(readFileSync(join(r.diretorio, 'DADOS_ABERTOS_MEDICAMENTOS.csv'))).toEqual(
      Buffer.from(bytes),
    );
    expect(lerManifesto(r.diretorio)).toEqual(r.manifesto);
  });

  it('baixar o mesmo conteúdo de novo não cria nada nem muda o manifesto original', async () => {
    const buscar = resposta(emLatin1(csvAmostra()));
    const a = await baixar({ destino: pasta, url: URL_TESTE, buscar, agora: dia('2026-11-11') });
    const b = await baixar({
      destino: pasta,
      url: URL_TESTE,
      buscar: resposta(emLatin1(csvAmostra())),
      agora: dia('2026-11-20'),
    });
    expect(b.novo).toBe(false);
    expect(b.diretorio).toBe(a.diretorio);
    expect(b.manifesto.baixadoEm).toBe('2026-11-11');
    expect(readdirSync(pasta)).toHaveLength(1);
  });

  it('conteúdo diferente vai para outra pasta', async () => {
    await baixar({
      destino: pasta,
      url: URL_TESTE,
      buscar: resposta(emLatin1(csvAmostra())),
      agora: dia('2026-11-11'),
    });
    await baixar({
      destino: pasta,
      url: URL_TESTE,
      buscar: resposta(emLatin1(csvAmostra().replace('TRESIBA', 'X'))),
      agora: dia('2026-11-12'),
    });
    expect(readdirSync(pasta)).toHaveLength(2);
  });

  it.each([
    ['HTTP de erro', resposta('não achei', { status: 404 }), /HTTP 404/],
    ['corpo vazio', resposta(''), /vazio/],
    ['página HTML no lugar do CSV', resposta('<!doctype html><html>erro</html>'), /HTML/],
  ])('falha com %s e não grava nada', async (_nome, buscar, erro) => {
    await expect(baixar({ destino: pasta, url: URL_TESTE, buscar })).rejects.toThrow(erro);
    await expect(baixar({ destino: pasta, url: URL_TESTE, buscar })).rejects.toBeInstanceOf(
      ErroArquivo,
    );
    expect(readdirSync(pasta)).toEqual([]);
  });

  it('falha de rede vira erro claro, com o endereço e a causa', async () => {
    const semRede = (async () => {
      throw new TypeError('fetch failed', {
        cause: new Error('getaddrinfo ENOTFOUND exemplo.invalid'),
      });
    }) as typeof fetch;
    await expect(baixar({ destino: pasta, url: URL_TESTE, buscar: semRede })).rejects.toThrow(
      /não foi possível acessar https:\/\/exemplo\.invalid.*ENOTFOUND/,
    );
  });

  it('pasta sem manifesto (download interrompido) é refeita', async () => {
    const bytes = emLatin1(csvAmostra());
    const primeira = await baixar({
      destino: pasta,
      url: URL_TESTE,
      buscar: resposta(bytes),
      agora: dia('2026-11-11'),
    });
    rmSync(join(primeira.diretorio, 'manifesto.json'));
    const segunda = await baixar({
      destino: pasta,
      url: URL_TESTE,
      buscar: resposta(bytes),
      agora: dia('2026-11-13'),
    });
    expect(segunda.novo).toBe(true);
    expect(segunda.manifesto.baixadoEm).toBe('2026-11-13');
  });
});

describe('ultimoDownload', () => {
  it('escolhe o de data mais recente e ignora pastas sem manifesto', async () => {
    await baixar({
      destino: pasta,
      url: URL_TESTE,
      buscar: resposta(emLatin1(csvAmostra())),
      agora: dia('2026-11-11'),
    });
    const novo = await baixar({
      destino: pasta,
      url: URL_TESTE,
      buscar: resposta(emLatin1(csvAmostra().replace('TRESIBA', 'X'))),
      agora: dia('2026-11-12'),
    });
    mkdirSync(join(pasta, 'lixo'));
    writeFileSync(join(pasta, 'lixo', 'qualquer.csv'), 'x');
    expect(ultimoDownload(pasta).diretorio).toBe(novo.diretorio);
  });

  it('avisa quando não há nenhum download', () => {
    expect(() => ultimoDownload(join(pasta, 'inexistente'))).toThrow(/rode "baixar"/);
  });
});
