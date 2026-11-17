import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { criarGlossario } from './glossario.js';
import { Memoria } from './memoria.js';
import { criarProtetor } from './protecao.js';
import {
  aplicarTraducoes,
  lerRespostaJson,
  montarLote,
  pendentes,
  traduzirLoteViaApi,
} from './rascunho.js';
import { extrairUnidades, type UnidadeTexto } from './textos.js';

const g = criarGlossario({
  versao: 1,
  termos: [{ en: 'bleeding', pt: 'sangramento', status: 'aprovado' }],
});
const protetor = criarProtetor([{ id: 'DDInter1', nome: 'Warfarin' }]);
const unidades: UnidadeTexto[] = extrairUnidades({
  textos: [
    { id: 1, nivel: 'Major', texto: 'Warfarin increases bleeding.' },
    { id: 2, nivel: 'Minor', texto: 'Monitor the patient.' },
  ],
  manejo: [],
  alimentos: [],
  doencas: [],
});
const memoria = () => new Memoria(join(mkdtempSync(join(tmpdir(), 'r-')), 'm.jsonl'));
const meta = { modelo: 'm', data: '2026-11-16' };

describe('lote e aplicação', () => {
  it('monta o lote com marcadores e só os termos do glossário que aparecem', () => {
    const lote = montarLote(unidades, protetor, g);
    expect(lote.itens.map((i) => i.en)).toEqual([
      '[[F1]] increases bleeding.',
      'Monitor the patient.',
    ]);
    expect(lote.glossario).toEqual([{ en: 'bleeding', pt: 'sangramento' }]);
    expect(montarLote([unidades[1] as UnidadeTexto], protetor, g).glossario).toEqual([]);
  });
  it('grava as válidas como nao-revisado e rejeita as com marcador perdido, sem gravar', () => {
    const m = memoria();
    const lote = montarLote(unidades, protetor, g);
    const r = aplicarTraducoes(
      lote,
      [
        { i: 1, pt: 'A varfarina aumenta o sangramento.' }, // perdeu o marcador
        { i: 2, pt: 'Monitore o paciente.' },
        { i: 9, pt: 'fantasma' },
      ],
      m,
      g,
      meta,
    );
    expect(r).toMatchObject({ gravados: 1, desconhecidos: ['9'] });
    expect(r.rejeitados.map((x) => x.id)).toEqual([lote.itens[0]?.id]);
    expect(m.estado(lote.itens[0]?.id as string)).toBeUndefined();
    expect(m.estado(lote.itens[1]?.id as string)).toMatchObject({
      status: 'nao-revisado',
      pt: 'Monitore o paciente.',
    });
    expect(pendentes(unidades, m).map((u) => u.en)).toEqual(['Warfarin increases bleeding.']);
  });
  it('não sobrescreve texto já revisado e lista o que a resposta não trouxe', () => {
    const m = memoria();
    const lote = montarLote(unidades, protetor, g);
    const id = lote.itens[1]?.id as string;
    m.registrarRascunho(id, 'Monitore.', { modelo: 'm', glossario: g.id, data: meta.data });
    m.aprovar(id, { glossario: g.id, data: meta.data });
    const r = aplicarTraducoes(lote, [{ id, pt: 'Outra.' }], m, g, meta);
    expect(r.gravados).toBe(0);
    expect(r.rejeitados[0]?.problemas[0]?.detalhe).toMatch(/já está revisado/);
    expect(r.faltando).toEqual([lote.itens[0]?.id]);
  });
});

describe('lerRespostaJson', () => {
  it('aceita lista, objeto com itens e cerca de código', () => {
    expect(lerRespostaJson('[{"i":1,"pt":"a"}]')).toEqual([{ i: 1, pt: 'a' }]);
    expect(lerRespostaJson('```json\n{"itens":[{"id":"x","pt":"b"}]}\n```')).toEqual([
      { id: 'x', pt: 'b' },
    ]);
  });
  it('recusa o que não é lista de traduções', () => {
    expect(() => lerRespostaJson('oi')).toThrow(/JSON válido/);
    expect(() => lerRespostaJson('{"a":1}')).toThrow(/lista/);
    expect(() => lerRespostaJson('[{"i":1}]')).toThrow(/sem "pt"/);
  });
});

describe('traduzirLoteViaApi', () => {
  const lote = montarLote(unidades, protetor, g);
  const ok = (texto: string) =>
    new Response(JSON.stringify({ content: [{ type: 'text', text: texto }] }), { status: 200 });

  it('envia chave, versão e o lote; devolve o texto', async () => {
    let visto:
      | {
          headers: Record<string, string>;
          corpo: { model: string; messages: Array<{ content: string }> };
        }
      | undefined;
    const f = (async (_u: unknown, init: RequestInit) => {
      visto = {
        headers: init.headers as Record<string, string>,
        corpo: JSON.parse(init.body as string),
      };
      return ok('[]');
    }) as unknown as typeof fetch;
    expect(await traduzirLoteViaApi(lote, { chave: 'k', modelo: 'mod', fetch: f })).toBe('[]');
    expect(visto?.headers['x-api-key']).toBe('k');
    expect(visto?.headers['anthropic-version']).toBe('2023-06-01');
    expect(visto?.corpo.model).toBe('mod');
    expect(visto?.corpo.messages[0]?.content).toContain('bleeding → sangramento');
    expect(visto?.corpo.messages[0]?.content).toContain('[[F1]] increases bleeding.');
  });
  it('recua em 429 respeitando retry-after e para em erro sem retentativa', async () => {
    const esperas: number[] = [];
    let n = 0;
    const f = (async () =>
      ++n === 1
        ? new Response('', { status: 429, headers: { 'retry-after': '7' } })
        : ok('[]')) as unknown as typeof fetch;
    await traduzirLoteViaApi(lote, {
      chave: 'k',
      fetch: f,
      esperar: async (ms) => void esperas.push(ms),
    });
    expect(esperas).toEqual([7000]);
    const f401 = (async () => new Response('', { status: 401 })) as unknown as typeof fetch;
    await expect(traduzirLoteViaApi(lote, { chave: 'k', fetch: f401 })).rejects.toThrow(/HTTP 401/);
  });
});
