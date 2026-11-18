import { ErroTraducao } from './erro.js';
import type { Glossario } from './glossario.js';
import { termosNoTexto } from './glossario.js';
import type { Memoria } from './memoria.js';
import type { Protetor } from './protecao.js';
import type { UnidadeTexto } from './textos.js';
import { temErro, validarTraducao, type Problema } from './validar.js';

export const MODELO_PADRAO = 'claude-sonnet-5-5';
export const TAMANHO_LOTE_PADRAO = 20;

export const REGRAS = [
  'Traduza do inglês para o português do Brasil, em registro técnico de farmácia clínica.',
  'Os marcadores [[F1]], [[F2]]... representam nomes de fármacos. Copie cada um exatamente como está, na mesma quantidade; nunca os traduza, remova, junte ou invente.',
  'Use os termos do glossário quando o termo em inglês aparecer.',
  'Não acrescente, omita nem suavize nenhuma informação clínica (gravidade, mecanismo, conduta, doses, números, unidades). Não explique nem comente.',
  'Mantenha siglas (CYP3A4, QT, INR etc.), números e unidades como estão.',
  'Devolva somente JSON: uma lista [{"i": <número do item>, "pt": "<tradução>"}], um objeto por item, sem texto fora do JSON.',
].join('\n');

export interface ItemLote {
  /** Posição no lote (1, 2, ...). */
  i: number;
  id: string;
  /** Texto em inglês com os nomes de fármaco já trocados por marcadores. */
  en: string;
}
export interface Lote {
  regras: string;
  glossario: Array<{ en: string; pt: string }>;
  itens: ItemLote[];
}

/** Unidades ainda sem nenhuma tradução, na ordem recebida (já por gravidade). */
export function pendentes(unidades: readonly UnidadeTexto[], memoria: Memoria): UnidadeTexto[] {
  return unidades.filter((u) => memoria.estado(u.id) === undefined);
}

export function montarLote(
  unidades: readonly UnidadeTexto[],
  protetor: Protetor,
  g: Glossario,
): Lote {
  const itens = unidades.map((u, k) => ({ i: k + 1, id: u.id, en: protetor.proteger(u.en).texto }));
  // só os termos que aparecem neste lote, para não gastar contexto à toa
  const usados = new Map<string, { en: string; pt: string }>();
  for (const it of itens) {
    for (const t of termosNoTexto(it.en, g)) usados.set(t.en, { en: t.en, pt: t.pt });
  }
  return { regras: REGRAS, glossario: [...usados.values()], itens };
}

/** Extrai a lista de traduções de uma resposta (aceita cerca de código ao redor do JSON). */
export function lerRespostaJson(texto: string): Array<{ i?: number; id?: string; pt: string }> {
  // modelos gratuitos costumam acrescentar bloco de raciocínio, cerca de código ou uma frase antes
  const limpo = texto.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const candidatos = [
    limpo,
    limpo.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''),
    limpo.slice(limpo.indexOf('['), limpo.lastIndexOf(']') + 1),
    limpo.slice(limpo.indexOf('{'), limpo.lastIndexOf('}') + 1),
  ];
  let bruto: unknown;
  let lido = false;
  for (const c of candidatos) {
    try {
      bruto = JSON.parse(c);
      lido = true;
      break;
    } catch {
      /* tenta o próximo */
    }
  }
  if (!lido) throw new ErroTraducao('a resposta não é JSON válido');
  const lista = Array.isArray(bruto)
    ? bruto
    : bruto !== null &&
        typeof bruto === 'object' &&
        Array.isArray((bruto as { itens?: unknown }).itens)
      ? (bruto as { itens: unknown[] }).itens
      : null;
  if (lista === null) throw new ErroTraducao('a resposta não é uma lista de traduções');
  return lista.map((x, k) => {
    const o = x as { i?: unknown; id?: unknown; pt?: unknown };
    if (typeof o?.pt !== 'string') throw new ErroTraducao(`item ${k + 1} da resposta sem "pt"`);
    return {
      ...(typeof o.i === 'number' ? { i: o.i } : {}),
      ...(typeof o.id === 'string' ? { id: o.id } : {}),
      pt: o.pt,
    };
  });
}

export interface Rejeicao {
  id: string;
  problemas: Problema[];
}
export interface ResultadoAplicacao {
  gravados: number;
  rejeitados: Rejeicao[];
  avisos: Array<{ id: string; problemas: Problema[] }>;
  /** Itens do lote para os quais a resposta não trouxe tradução. */
  faltando: string[];
  /** Respostas com id que não está no lote. */
  desconhecidos: string[];
}

/**
 * Valida cada tradução contra o texto protegido e grava as aprovadas na memória como
 * `nao-revisado`. O que reprova não é gravado e volta em `rejeitados`, com os motivos.
 * A tradução guardada tem os marcadores (o nome vem na hora de mostrar); ver `protecao.ts`.
 */
export function aplicarTraducoes(
  lote: Lote,
  traducoes: ReadonlyArray<{ i?: number; id?: string; pt: string }>,
  memoria: Memoria,
  g: Glossario,
  meta: { modelo: string; data: string },
): ResultadoAplicacao {
  const porId = new Map(lote.itens.map((it) => [it.id, it]));
  const porPos = new Map(lote.itens.map((it) => [it.i, it]));
  const r: ResultadoAplicacao = {
    gravados: 0,
    rejeitados: [],
    avisos: [],
    faltando: [],
    desconhecidos: [],
  };
  const vistos = new Set<string>();
  for (const t of traducoes) {
    const item =
      t.id !== undefined ? porId.get(t.id) : t.i !== undefined ? porPos.get(t.i) : undefined;
    if (item === undefined) {
      r.desconhecidos.push(t.id ?? String(t.i));
      continue;
    }
    if (vistos.has(item.id)) {
      r.rejeitados.push({
        id: item.id,
        problemas: [
          { gravidade: 'erro', tipo: 'vazio', detalhe: 'traduzido mais de uma vez na resposta' },
        ],
      });
      continue;
    }
    vistos.add(item.id);
    const problemas = validarTraducao(item.en, t.pt, g);
    if (temErro(problemas)) {
      r.rejeitados.push({ id: item.id, problemas });
      continue;
    }
    const atual = memoria.estado(item.id);
    if (atual !== undefined && atual.status !== 'nao-revisado') {
      r.rejeitados.push({
        id: item.id,
        problemas: [
          { gravidade: 'erro', tipo: 'vazio', detalhe: `já está ${atual.status}; não sobrescreve` },
        ],
      });
      continue;
    }
    memoria.registrarRascunho(item.id, t.pt.trim(), {
      modelo: meta.modelo,
      glossario: g.id,
      data: meta.data,
    });
    r.gravados++;
    if (problemas.length > 0) r.avisos.push({ id: item.id, problemas });
  }
  r.faltando = lote.itens.filter((it) => !vistos.has(it.id)).map((it) => it.id);
  return r;
}

// ---------------------------------------------------------------- API (rascunho automático)

export type Provedor =
  'anthropic' | 'gemini' | 'openai' | 'groq' | 'cerebras' | 'openrouter' | 'github' | 'mistral';
export const PROVEDORES: readonly Provedor[] = [
  'anthropic',
  'gemini',
  'openai',
  'groq',
  'cerebras',
  'openrouter',
  'github',
  'mistral',
];
/** Endereço base das APIs compatíveis com o formato "chat/completions" da OpenAI. */
export const URL_PROVEDOR: Partial<Record<Provedor, string>> = {
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  github: 'https://models.github.ai/inference',
  mistral: 'https://api.mistral.ai/v1',
};

export interface OpcoesApi {
  chave: string;
  provedor?: Provedor;
  /** Obrigatório fora da Anthropic: os nomes dos modelos gratuitos mudam com frequência. */
  modelo?: string;
  /** Endereço base (compatíveis com OpenAI) ou endereço completo do pedido (Anthropic). */
  url?: string;
  fetch?: typeof fetch;
  /** Espera entre tentativas, em ms; injetável nos testes. */
  esperar?: (ms: number) => Promise<void>;
}
const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function conteudoDoUsuario(lote: Lote): string {
  return (
    'Glossário:\n' +
    (lote.glossario.length === 0
      ? '(nenhum termo neste lote)'
      : lote.glossario.map((t) => `- ${t.en} → ${t.pt}`).join('\n')) +
    '\n\nItens (JSON):\n' +
    JSON.stringify(lote.itens.map((it) => ({ i: it.i, en: it.en })))
  );
}

interface Pedido {
  url: string;
  headers: Record<string, string>;
  corpo: unknown;
  extrair: (json: unknown) => string | undefined;
}

function montarPedido(lote: Lote, o: OpcoesApi): Pedido {
  const provedor = o.provedor ?? 'anthropic';
  const usuario = conteudoDoUsuario(lote);
  if (provedor === 'anthropic') {
    return {
      url: o.url ?? 'https://api.anthropic.com/v1/messages',
      headers: { 'x-api-key': o.chave, 'anthropic-version': '2023-06-01' },
      corpo: {
        model: o.modelo ?? MODELO_PADRAO,
        max_tokens: 8000,
        system: lote.regras,
        messages: [{ role: 'user', content: usuario }],
      },
      extrair: (j) =>
        (j as { content?: Array<{ type: string; text?: string }> }).content?.find(
          (c) => c.type === 'text',
        )?.text,
    };
  }
  if (o.modelo === undefined || o.modelo === '') {
    throw new ErroTraducao(
      `informe --modelo para o provedor ${provedor} (os nomes dos modelos gratuitos mudam; veja a lista no site do provedor)`,
    );
  }
  if (provedor === 'gemini') {
    const base = o.url ?? 'https://generativelanguage.googleapis.com/v1beta';
    return {
      url: `${base}/models/${encodeURIComponent(o.modelo)}:generateContent`,
      headers: { 'x-goog-api-key': o.chave },
      corpo: {
        systemInstruction: { parts: [{ text: lote.regras }] },
        contents: [{ role: 'user', parts: [{ text: usuario }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      },
      extrair: (j) =>
        (
          j as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
        ).candidates?.[0]?.content?.parts
          ?.map((p) => p.text ?? '')
          .join(''),
    };
  }
  const base = o.url ?? URL_PROVEDOR[provedor];
  if (base === undefined) throw new ErroTraducao(`provedor desconhecido: ${provedor}`);
  return {
    url: `${base.replace(/\/$/, '')}/chat/completions`,
    headers: { authorization: `Bearer ${o.chave}` },
    corpo: {
      model: o.modelo,
      temperature: 0,
      messages: [
        { role: 'system', content: lote.regras },
        { role: 'user', content: usuario },
      ],
    },
    extrair: (j) =>
      (j as { choices?: Array<{ message?: { content?: string | null } }> }).choices?.[0]?.message
        ?.content ?? undefined,
  };
}

/**
 * Pede a tradução de um lote a uma API de modelo de linguagem (Anthropic, Gemini ou qualquer
 * provedor compatível com "chat/completions": Groq, Cerebras, OpenRouter, GitHub Models, Mistral,
 * OpenAI). Tenta de novo em 429 e 5xx, com espera crescente, e depois para sem insistir.
 */
export async function traduzirLoteViaApi(lote: Lote, o: OpcoesApi): Promise<string> {
  const f = o.fetch ?? fetch;
  const esperar = o.esperar ?? dormir;
  const pedido = montarPedido(lote, o);
  let espera = 10_000;
  for (let tentativa = 1; tentativa <= 5; tentativa++) {
    const resp = await f(pedido.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...pedido.headers },
      body: JSON.stringify(pedido.corpo),
    });
    if (resp.ok) {
      const texto = pedido.extrair(await resp.json());
      if (texto === undefined || texto.trim() === '')
        throw new ErroTraducao('a API respondeu sem texto');
      return texto;
    }
    const retentavel = resp.status === 429 || resp.status >= 500;
    if (!retentavel || tentativa === 5) {
      const corpo = (await resp.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
      throw new ErroTraducao(
        `API recusou o pedido (HTTP ${resp.status})${resp.status === 429 ? ': limite de uso atingido; o progresso está salvo, rode de novo mais tarde' : ''}${corpo === '' ? '' : `. Resposta: ${corpo}`}`,
      );
    }
    const ra = Number(resp.headers.get('retry-after'));
    await esperar(Number.isFinite(ra) && ra > 0 ? ra * 1000 : espera);
    espera *= 2;
  }
  throw new ErroTraducao('API sem resposta');
}
