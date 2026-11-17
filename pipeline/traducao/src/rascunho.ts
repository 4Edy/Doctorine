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
  const limpo = texto
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let bruto: unknown;
  try {
    bruto = JSON.parse(limpo);
  } catch {
    throw new ErroTraducao('a resposta não é JSON válido');
  }
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

export interface OpcoesApi {
  chave: string;
  modelo?: string;
  fetch?: typeof fetch;
  /** Espera entre tentativas, em ms; injetável nos testes. */
  esperar?: (ms: number) => Promise<void>;
  url?: string;
}
const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Pede a tradução de um lote à API de mensagens da Anthropic. Tenta de novo em 429 e 5xx. */
export async function traduzirLoteViaApi(lote: Lote, o: OpcoesApi): Promise<string> {
  const f = o.fetch ?? fetch;
  const esperar = o.esperar ?? dormir;
  const corpo = {
    model: o.modelo ?? MODELO_PADRAO,
    max_tokens: 8000,
    system: lote.regras,
    messages: [
      {
        role: 'user',
        content:
          'Glossário:\n' +
          (lote.glossario.length === 0
            ? '(nenhum termo neste lote)'
            : lote.glossario.map((t) => `- ${t.en} → ${t.pt}`).join('\n')) +
          '\n\nItens (JSON):\n' +
          JSON.stringify(lote.itens.map((it) => ({ i: it.i, en: it.en }))),
      },
    ],
  };
  let espera = 5_000;
  for (let tentativa = 1; tentativa <= 4; tentativa++) {
    const resp = await f(o.url ?? 'https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': o.chave,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(corpo),
    });
    if (resp.ok) {
      const json = (await resp.json()) as { content?: Array<{ type: string; text?: string }> };
      const texto = json.content?.find((c) => c.type === 'text')?.text;
      if (texto === undefined) throw new ErroTraducao('a API respondeu sem texto');
      return texto;
    }
    const retentavel = resp.status === 429 || resp.status >= 500;
    if (!retentavel || tentativa === 4) {
      throw new ErroTraducao(`API recusou o pedido (HTTP ${resp.status}); parando sem insistir`);
    }
    const ra = Number(resp.headers.get('retry-after'));
    await esperar(Number.isFinite(ra) && ra > 0 ? ra * 1000 : espera);
    espera *= 2;
  }
  throw new ErroTraducao('API sem resposta');
}
