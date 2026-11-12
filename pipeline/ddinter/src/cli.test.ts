import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executar } from './cli.js';
import { conjuntoAmostra } from './fixtures.js';

const dia = (iso: string) => () => new Date(`${iso}T15:00:00Z`);
const servidor = (async (url: string | URL | Request) => {
  const letra = /code_([A-Z])\.csv$/.exec(String(url))?.[1];
  const a = conjuntoAmostra().find((x) => x.letra === letra);
  return new Response(a?.bytes ?? 'x', { status: a ? 200 : 404 });
}) as typeof fetch;

let raiz: string;
beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), 'doctorine-cli-ddinter-'));
});
afterEach(() => {
  rmSync(raiz, { recursive: true, force: true });
});

const lerSaida = (): Record<string, string> => {
  const base = join(raiz, 'data', 'processed', 'ddinter');
  const [versao] = readdirSync(base);
  const dir = join(base, versao as string);
  return Object.fromEntries(readdirSync(dir).map((n) => [n, readFileSync(join(dir, n), 'utf8')]));
};

describe('executar', () => {
  it('devolve 2 e o uso para comando desconhecido ou argumento incorreto', async () => {
    for (const argv of [
      [],
      ['voar'],
      ['baixar', 'extra'],
      ['baixar', '--base-url'],
      ['importar'],
      ['importar', 'a', 'b'],
      ['importar', 'a', '--pasta', 'b'],
    ]) {
      expect((await executar(argv, { raiz })).codigo).toBe(2);
    }
  });

  it('"tudo" baixa, processa e grava interações, medicamentos e relatório', async () => {
    const r = await executar(['tudo', '--base-url', 'https://exemplo.invalid/d'], {
      raiz,
      buscar: servidor,
      agora: dia('2026-11-12'),
    });
    expect(r.codigo).toBe(0);
    const texto = r.linhas.join('\n');
    expect(texto).toContain('Baixado: 8 arquivos');
    expect(texto).toContain(
      '11 linhas = 10 interações distintas + 1 repetidas + 0 rejeitadas (0 avisos; 15 medicamentos)',
    );
    const saida = lerSaida();
    expect(Object.keys(saida).sort()).toEqual([
      'avisos.jsonl',
      'farmacos.jsonl',
      'interacoes.jsonl',
      'rejeicoes.jsonl',
      'relatorio-qualidade.json',
      'relatorio-qualidade.md',
    ]);
    expect(saida['interacoes.jsonl']?.trim().split('\n')).toHaveLength(10);
    expect(saida['relatorio-qualidade.md']).toContain('Cobertura: leia antes de usar');
  });

  it('"importar <pasta>" + "processar" geram a mesma saída que "tudo" (idempotência de ponta a ponta)', async () => {
    const origem = join(raiz, 'baixados');
    mkdirSync(origem);
    for (const a of conjuntoAmostra())
      writeFileSync(join(origem, `x-ddinter_downloads_code_${a.letra}.csv`), a.bytes);
    const i = await executar(['importar', origem], { raiz, agora: dia('2026-11-12') });
    expect(i.codigo).toBe(0);
    expect(i.linhas.join('\n')).toContain('Importado: 8 arquivos');
    const p = await executar(['processar'], { raiz });
    expect(p.codigo).toBe(0);
    const primeira = lerSaida();
    const p2 = await executar(['processar'], { raiz });
    expect(p2.codigo).toBe(0);
    expect(lerSaida()).toEqual(primeira);
  });

  it('"tudo --pasta" importa em vez de baixar', async () => {
    const origem = join(raiz, 'baixados');
    mkdirSync(origem);
    for (const a of conjuntoAmostra())
      writeFileSync(join(origem, `ddinter_downloads_code_${a.letra}.csv`), a.bytes);
    const r = await executar(['tudo', '--pasta', origem], { raiz, agora: dia('2026-11-12') });
    expect(r.codigo).toBe(0);
    expect(r.linhas.join('\n')).toContain('Importado: 8 arquivos');
  });

  it('devolve 1 com a mensagem quando o conjunto está incompleto ou o checksum não confere', async () => {
    const vazio = await executar(['processar'], { raiz });
    expect(vazio.codigo).toBe(1);
    expect(vazio.linhas.join('\n')).toContain('Erro: nenhum download encontrado');

    await executar(['tudo', '--base-url', 'https://exemplo.invalid/d'], {
      raiz,
      buscar: servidor,
      agora: dia('2026-11-12'),
    });
    const bruto = join(raiz, 'data', 'raw', 'ddinter');
    const [versao] = readdirSync(bruto);
    writeFileSync(join(bruto, versao as string, 'ddinter_downloads_code_B.csv'), 'adulterado\n');
    const r = await executar(['processar'], { raiz });
    expect(r.codigo).toBe(1);
    expect(r.linhas.join('\n')).toMatch(/Erro: .*(cabeçalho|checksum)/);
  });
});
