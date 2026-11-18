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
    const f401 = (async () =>
      new Response('{"error":{"message":"modelo inexistente"}}', {
        status: 401,
      })) as unknown as typeof fetch;
    await expect(traduzirLoteViaApi(lote, { chave: 'k', fetch: f401 })).rejects.toThrow(
      /HTTP 401.*modelo inexistente/,
    );
  });

  it('Gemini: chave no cabeçalho, instrução de sistema, resposta em candidates', async () => {
    let visto: { url: string; headers: Record<string, string>; corpo: any } | undefined;
    const f = (async (url: string, init: RequestInit) => {
      visto = {
        url,
        headers: init.headers as Record<string, string>,
        corpo: JSON.parse(init.body as string),
      };
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: '[{"i":1,"pt":"a"}]' }] } }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const r = await traduzirLoteViaApi(lote, {
      chave: 'k',
      provedor: 'gemini',
      modelo: 'gemini-x',
      fetch: f,
    });
    expect(r).toBe('[{"i":1,"pt":"a"}]');
    expect(visto?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent',
    );
    expect(visto?.headers['x-goog-api-key']).toBe('k');
    expect(visto?.corpo.systemInstruction.parts[0].text).toContain('marcadores');
    expect(visto?.corpo.contents[0].parts[0].text).toContain('[[F1]] increases bleeding.');
  });
  it('compatível com OpenAI (Groq etc.): Bearer, system e user, resposta em choices', async () => {
    let visto: { url: string; headers: Record<string, string>; corpo: any } | undefined;
    const f = (async (url: string, init: RequestInit) => {
      visto = {
        url,
        headers: init.headers as Record<string, string>,
        corpo: JSON.parse(init.body as string),
      };
      return new Response(JSON.stringify({ choices: [{ message: { content: '[]' } }] }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    await traduzirLoteViaApi(lote, { chave: 'k', provedor: 'groq', modelo: 'm1', fetch: f });
    expect(visto?.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(visto?.headers['authorization']).toBe('Bearer k');
    expect(visto?.corpo.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user']);
    await traduzirLoteViaApi(lote, {
      chave: 'k',
      provedor: 'openai',
      modelo: 'm',
      url: 'http://x/v1/',
      fetch: f,
    });
    expect(visto?.url).toBe('http://x/v1/chat/completions');
  });
  it('falha de rede ou tempo esgotado é tentada de novo e, persistindo, para com dica', async () => {
    let n = 0;
    const f = (async () => {
      if (++n < 3) throw new TypeError('fetch failed');
      return ok('[]');
    }) as unknown as typeof fetch;
    const esperas: number[] = [];
    expect(
      await traduzirLoteViaApi(lote, {
        chave: 'k',
        fetch: f,
        esperar: async (ms) => void esperas.push(ms),
      }),
    ).toBe('[]');
    expect(esperas).toEqual([10000, 20000]);
    const sempre = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(
      traduzirLoteViaApi(lote, { chave: 'k', fetch: sempre, esperar: async () => undefined }),
    ).rejects.toThrow(/sem resposta da API.*--lote menor/);
  });
  it('fora da Anthropic exige --modelo, e 429 persistente para com mensagem útil', async () => {
    await expect(traduzirLoteViaApi(lote, { chave: 'k', provedor: 'gemini' })).rejects.toThrow(
      /--modelo/,
    );
    const f = (async () => new Response('', { status: 429 })) as unknown as typeof fetch;
    const esperas: number[] = [];
    await expect(
      traduzirLoteViaApi(lote, {
        chave: 'k',
        provedor: 'groq',
        modelo: 'm',
        fetch: f,
        esperar: async (ms) => void esperas.push(ms),
      }),
    ).rejects.toThrow(/limite de uso atingido/);
    expect(esperas).toEqual([10000, 20000, 40000, 80000]);
  });
});

describe('lerRespostaJson com modelos gratuitos', () => {
  it('ignora bloco de raciocínio, frase antes e cerca de código', () => {
    expect(lerRespostaJson('<think>hmm [1]</think>\n[{"i":1,"pt":"a"}]')).toEqual([
      { i: 1, pt: 'a' },
    ]);
    expect(
      lerRespostaJson('Aqui está a tradução:\n```json\n[{"i":2,"pt":"b"}]\n```\nPronto.'),
    ).toEqual([{ i: 2, pt: 'b' }]);
  });
});
