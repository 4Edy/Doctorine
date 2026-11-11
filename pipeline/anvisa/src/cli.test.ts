import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executar } from './cli.js';
import { csvAmostra, emLatin1 } from './fixtures.js';

const dia = (iso: string) => () => new Date(`${iso}T15:00:00Z`);
const servidor = (texto: string) =>
  (async () => new Response(emLatin1(texto), { status: 200 })) as typeof fetch;

const raizes: string[] = [];
const novaRaiz = (): string => {
  const r = mkdtempSync(join(tmpdir(), 'doctorine-cli-'));
  raizes.push(r);
  return r;
};
let raiz: string;
beforeEach(() => {
  raiz = novaRaiz();
});
afterEach(() => {
  for (const r of raizes.splice(0)) rmSync(r, { recursive: true, force: true });
});

const lerSaida = (r: string): Record<string, string> => {
  const base = join(r, 'data', 'processed', 'anvisa');
  const [versao] = readdirSync(base);
  const dir = join(base, versao as string);
  return Object.fromEntries(readdirSync(dir).map((n) => [n, readFileSync(join(dir, n), 'utf8')]));
};

describe('executar', () => {
  it('devolve 2 e o uso para comando desconhecido ou argumento sobrando', async () => {
    expect((await executar([], { raiz })).codigo).toBe(2);
    expect((await executar(['voar'], { raiz })).codigo).toBe(2);
    expect((await executar(['baixar', 'extra'], { raiz })).codigo).toBe(2);
    expect((await executar(['baixar', '--url'], { raiz })).codigo).toBe(2);
  });

  it('"tudo" baixa, processa e grava o relatório', async () => {
    const r = await executar(['tudo'], {
      raiz,
      buscar: servidor(csvAmostra()),
      agora: dia('2026-11-11'),
    });
    expect(r.codigo).toBe(0);
    expect(r.linhas.join('\n')).toContain('Baixado: DADOS_ABERTOS_MEDICAMENTOS.csv');
    expect(r.linhas.join('\n')).toContain('8 linhas, 8 válidas, 0 rejeitadas');
    expect(Object.keys(lerSaida(raiz))).toEqual([
      'registros.jsonl',
      'rejeicoes.jsonl',
      'relatorio-qualidade.json',
      'relatorio-qualidade.md',
    ]);
  });

  it('"processar" usa o download mais recente e exige que exista um', async () => {
    const sem = await executar(['processar'], { raiz });
    expect(sem.codigo).toBe(1);
    expect(sem.linhas.join('\n')).toContain('rode "baixar"');

    await executar(['baixar'], { raiz, buscar: servidor(csvAmostra()), agora: dia('2026-11-11') });
    const r = await executar(['processar'], { raiz });
    expect(r.codigo).toBe(0);
    expect(r.linhas.join('\n')).toContain('Processado a versão');
  });

  it('idempotente na mesma pasta: rodar "tudo" duas vezes não muda nenhum arquivo', async () => {
    const deps = { raiz, buscar: servidor(csvAmostra()), agora: dia('2026-11-11') };
    await executar(['tudo'], deps);
    const antes = lerSaida(raiz);
    const segunda = await executar(['tudo'], { ...deps, agora: dia('2026-12-01') });
    expect(segunda.linhas.join('\n')).toContain('Já baixado (mesmo checksum)');
    expect(lerSaida(raiz)).toEqual(antes);
  });

  it('do zero em duas pastas diferentes, o resultado é idêntico', async () => {
    const deps = { buscar: servidor(csvAmostra()), agora: dia('2026-11-11') };
    await executar(['tudo'], { raiz, ...deps });
    const outra = novaRaiz();
    await executar(['tudo'], { raiz: outra, ...deps });
    expect(lerSaida(outra)).toEqual(lerSaida(raiz));
  });

  it('detecta arquivo bruto alterado depois do download (checksum)', async () => {
    await executar(['baixar'], { raiz, buscar: servidor(csvAmostra()), agora: dia('2026-11-11') });
    const bruto = join(raiz, 'data', 'raw', 'anvisa');
    const [versao] = readdirSync(bruto);
    writeFileSync(
      join(bruto, versao as string, 'DADOS_ABERTOS_MEDICAMENTOS.csv'),
      emLatin1(csvAmostra().replace('TRESIBA', 'ADULTERADO')),
    );
    const r = await executar(['processar'], { raiz });
    expect(r.codigo).toBe(1);
    expect(r.linhas.join('\n')).toContain('checksum não confere');
  });

  it('cabeçalho novo na fonte derruba o processamento com mensagem clara', async () => {
    const r = await executar(['tudo'], {
      raiz,
      buscar: servidor(csvAmostra().replace('TIPO_PRODUTO', 'TIPO')),
      agora: dia('2026-11-11'),
    });
    expect(r.codigo).toBe(1);
    expect(r.linhas.join('\n')).toContain('cabeçalho inesperado');
  });
});
