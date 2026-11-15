import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { DECISOES_VAZIAS, validarDecisoes, type ArquivoDecisoes } from '@doctorine/mapeamento';

/** Falha da carga inteira (entrada faltando, arquivo fora do formato, versão que não bate). */
export class ErroCarga extends Error {
  override name = 'ErroCarga';
}

const NIVEL = z.enum(['Major', 'Moderate', 'Minor', 'Unknown']);
const texto = z.string();
const textoOuNulo = z.string().nullable();
const idDdinter = z.string().regex(/^DDInter\d+$/);

// ---- relatórios de qualidade (só o que a carga usa) ----
const fonteBase = {
  id: texto,
  sha256: texto.regex(/^[0-9a-f]{64}$/),
  versao: texto.regex(/^[0-9a-f]{12}$/),
  baixadoEm: texto.regex(/^\d{4}-\d{2}-\d{2}$/),
};
const relatorio = (extra: z.ZodRawShape = {}) =>
  z.object({ fonte: z.object({ ...fonteBase, ...extra }) });

export const relatorioAnvisa = relatorio({ url: textoOuNulo });
export const relatorioDdinter = relatorio({ origem: textoOuNulo });
export const relatorioSite = relatorio({ origem: textoOuNulo });
export const relatorioPares = relatorio();
export const relatorioManejo = relatorio();

export interface FonteRelatorio {
  id: string;
  sha256: string;
  versao: string;
  baixadoEm: string;
  origem: string | null;
  url: string | null;
}

// ---- linhas dos .jsonl ----
export const registroAnvisa = z.object({
  tipoProduto: texto,
  nomeProduto: texto,
  dataFinalizacaoProcesso: textoOuNulo,
  categoriaRegulatoria: textoOuNulo,
  numeroRegistro: textoOuNulo,
  vencimentoRegistro: textoOuNulo,
  numeroProcesso: textoOuNulo,
  classeTerapeutica: textoOuNulo,
  empresa: z.object({ cnpj: textoOuNulo, nome: texto }).nullable(),
  situacaoRegistro: texto,
  principioAtivo: textoOuNulo,
  proveniencia: z.object({ linha: z.number().int().positive() }),
});
export type RegistroAnvisaEntrada = z.infer<typeof registroAnvisa>;

export const interacaoCsv = z.object({
  idA: idDdinter,
  nomeA: texto,
  idB: idDdinter,
  nomeB: texto,
  nivel: NIVEL,
  proveniencia: z.object({ origens: z.array(z.object({ arquivo: texto, linha: z.number() })) }),
});
export type InteracaoCsvEntrada = z.infer<typeof interacaoCsv>;

export const farmacoCsv = z.object({ id: idDdinter, nome: texto });

const provSite = z.object({ arquivo: texto, linha: z.number().int().positive() });
export const textoSite = z.object({
  id: z.number().int().nonnegative(),
  nivel: NIVEL,
  texto: textoOuNulo,
  mecanismos: z.array(texto),
  proveniencia: provSite,
});
export const alimentoSite = z.object({
  id: z.number().int().nonnegative(),
  idFarmaco: idDdinter,
  farmaco: texto,
  alimento: texto,
  nivel: NIVEL,
  mecanismo: textoOuNulo,
  interacao: texto,
  manejo: texto,
  referencias: textoOuNulo,
  proveniencia: provSite,
});
export const doencaSite = z.object({
  id: z.number().int().nonnegative(),
  idFarmaco: idDdinter,
  farmaco: texto,
  doenca: texto,
  nivel: NIVEL,
  texto,
  referencias: textoOuNulo,
  proveniencia: provSite,
});
export const duplicidadeSite = z.object({
  produto: texto,
  composicao: texto,
  classe: texto,
  idFarmaco: idDdinter,
  farmaco: texto,
  aviso: texto,
  nota: texto,
  proveniencia: provSite,
});

const ladoPar = z.object({ id: idDdinter, drugbank: textoOuNulo, nome: texto });
export const parSite = z.object({
  idPar: z.number().int().nonnegative(),
  idTexto: z.number().int().nonnegative(),
  nivel: NIVEL,
  mecanismos: z.array(texto),
  a: ladoPar,
  b: ladoPar,
});
export const farmacoPares = z.object({ id: idDdinter, drugbank: textoOuNulo, nome: texto });

export const textoManejo = z.object({
  idTexto: z.number().int().nonnegative(),
  idParLido: z.number().int().nonnegative(),
  interacao: textoOuNulo,
  manejo: textoOuNulo,
  referencias: z.array(texto),
});
const farmacoAlt = z.object({ id: idDdinter, nome: texto });
export const alternativasPar = z.object({
  idPar: z.number().int().nonnegative(),
  idTexto: z.number().int().nonnegative(),
  idFarmaco: idDdinter,
  nome: texto,
  idParceiro: idDdinter.nullable(),
  grupos: z.array(z.object({ atc: textoOuNulo, farmacos: z.array(farmacoAlt) })),
  completo: z.array(farmacoAlt),
});

/** Decisões humanas do mapeamento (P7) e nomes do conjunto de referência da farmacêutica. */
export interface EntradaMapeamentoArquivos {
  decisoes: ArquivoDecisoes;
  referencia: Array<{ id: string; nome: string }>;
}

export interface Entradas {
  mapeamento: EntradaMapeamentoArquivos;
  anvisa: { fonte: FonteRelatorio; registros: RegistroAnvisaEntrada[] };
  csv: {
    fonte: FonteRelatorio;
    interacoes: z.infer<typeof interacaoCsv>[];
    farmacos: z.infer<typeof farmacoCsv>[];
  };
  site: {
    fonte: FonteRelatorio;
    textos: z.infer<typeof textoSite>[];
    alimentos: z.infer<typeof alimentoSite>[];
    doencas: z.infer<typeof doencaSite>[];
    duplicidade: z.infer<typeof duplicidadeSite>[];
  };
  pares: {
    fonte: FonteRelatorio;
    pares: z.infer<typeof parSite>[];
    farmacos: z.infer<typeof farmacoPares>[];
  };
  manejo: {
    fonte: FonteRelatorio;
    textos: z.infer<typeof textoManejo>[];
    alternativas: z.infer<typeof alternativasPar>[];
  };
}

/** Lê um `.jsonl` validando cada linha; o erro diz o arquivo e a linha. */
export function lerJsonl<T>(caminho: string, esquema: z.ZodType<T>): T[] {
  if (!existsSync(caminho)) throw new ErroCarga(`arquivo não encontrado: ${caminho}`);
  const saida: T[] = [];
  const linhas = readFileSync(caminho, 'utf8').split('\n');
  for (const [i, linha] of linhas.entries()) {
    if (linha.trim() === '') continue;
    let bruto: unknown;
    try {
      bruto = JSON.parse(linha);
    } catch {
      throw new ErroCarga(`${caminho}, linha ${i + 1}: JSON inválido`);
    }
    const r = esquema.safeParse(bruto);
    if (!r.success) {
      const motivo = r.error.issues
        .slice(0, 3)
        .map((p) => `${p.path.join('.') || '(linha)'}: ${p.message}`)
        .join('; ');
      throw new ErroCarga(`${caminho}, linha ${i + 1}: ${motivo}`);
    }
    saida.push(r.data);
  }
  return saida;
}

function lerRelatorio(pasta: string, esquema: z.ZodType<{ fonte: Record<string, unknown> }>) {
  const caminho = join(pasta, 'relatorio-qualidade.json');
  if (!existsSync(caminho))
    throw new ErroCarga(`relatório de qualidade não encontrado: ${caminho}`);
  const r = esquema.safeParse(JSON.parse(readFileSync(caminho, 'utf8')));
  if (!r.success)
    throw new ErroCarga(`${caminho}: fora do formato esperado (${r.error.issues[0]?.message})`);
  const f = r.data.fonte;
  return {
    id: f.id as string,
    sha256: f.sha256 as string,
    versao: f.versao as string,
    baixadoEm: f.baixadoEm as string,
    origem: (f.origem as string | null | undefined) ?? null,
    url: (f.url as string | null | undefined) ?? null,
  } satisfies FonteRelatorio;
}

/**
 * Escolhe a versão a carregar em `<raiz>/data/processed/<fonte>/`: a pedida, ou a de download mais
 * recente (empate: maior código de versão). Confere que o relatório da pasta é da versão do nome.
 */
export function localizar(
  raiz: string,
  fonte: string,
  esquema: z.ZodType<{ fonte: Record<string, unknown> }>,
  versao?: string,
): { pasta: string; fonte: FonteRelatorio } {
  const base = join(raiz, 'data', 'processed', fonte);
  if (!existsSync(base)) {
    throw new ErroCarga(
      `nenhuma saída de "${fonte}" em ${base}; rode o pipeline dessa fonte antes`,
    );
  }
  const candidatas = readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(base, e.name, 'relatorio-qualidade.json')))
    .map((e) => e.name);
  if (versao !== undefined) {
    if (!candidatas.includes(versao)) {
      throw new ErroCarga(`versão ${versao} de "${fonte}" não encontrada em ${base}`);
    }
    candidatas.splice(0, candidatas.length, versao);
  }
  const lidas = candidatas.map((nome) => ({
    pasta: join(base, nome),
    fonte: lerRelatorio(join(base, nome), esquema),
    nome,
  }));
  for (const l of lidas) {
    if (l.fonte.versao !== l.nome) {
      throw new ErroCarga(
        `${l.pasta}: o relatório diz versão ${l.fonte.versao}, mas a pasta é ${l.nome}`,
      );
    }
  }
  lidas.sort(
    (a, b) =>
      b.fonte.baixadoEm.localeCompare(a.fonte.baixadoEm) ||
      b.fonte.versao.localeCompare(a.fonte.versao),
  );
  const [melhor] = lidas;
  if (melhor === undefined) throw new ErroCarga(`nenhuma versão de "${fonte}" em ${base}`);
  return { pasta: melhor.pasta, fonte: melhor.fonte };
}

export const CAMINHO_DECISOES = join('data', 'mapeamento', 'decisoes.json');
export const CAMINHO_REFERENCIA = join('data', 'reference-set', 'pairs.json');

const sha12 = (t: string): string => createHash('sha256').update(t).digest('hex').slice(0, 12);

/**
 * Proveniência das decisões, calculada sempre a partir do conteúdo: mudar uma decisão muda a
 * versão da base (ela entra em `versaoDasEntradas` e em `fonte_versao`).
 */
export function fonteDasDecisoes(dados: ArquivoDecisoes): FonteRelatorio {
  const texto = JSON.stringify(dados);
  return {
    id: 'mapeamento-decisoes',
    sha256: createHash('sha256').update(texto).digest('hex'),
    versao: sha12(texto),
    baixadoEm: dados.atualizadoEm,
    origem: 'manual',
    url: null,
  };
}

/** Lê o arquivo de decisões (ausente = nenhuma decisão); recusa um arquivo fora do formato. */
export function lerDecisoes(caminho: string): ArquivoDecisoes {
  const bruto = existsSync(caminho) ? readFileSync(caminho, 'utf8') : null;
  let dados = DECISOES_VAZIAS;
  if (bruto !== null) {
    let json: unknown;
    try {
      json = JSON.parse(bruto);
    } catch {
      throw new ErroCarga(`${caminho}: JSON inválido`);
    }
    const r = validarDecisoes(json);
    if (!r.ok) throw new ErroCarga(`${caminho}: ${r.problemas.slice(0, 5).join('; ')}`);
    dados = r.dados;
  }
  return dados;
}

const parReferencia = z.object({
  id: z.string(),
  a: z.object({ tipo: z.string(), nome: z.string() }),
  b: z.object({ tipo: z.string(), nome: z.string() }),
});

/** Nomes de princípios ativos do conjunto de referência (lados `a` e `b`), sem repetir. */
export function lerNomesDaReferencia(caminho: string): Array<{ id: string; nome: string }> {
  if (!existsSync(caminho)) return [];
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(caminho, 'utf8'));
  } catch {
    throw new ErroCarga(`${caminho}: JSON inválido`);
  }
  const r = z.object({ pares: z.array(parReferencia) }).safeParse(json);
  if (!r.success) throw new ErroCarga(`${caminho}: fora do formato esperado`);
  const vistos = new Set<string>();
  const saida: Array<{ id: string; nome: string }> = [];
  for (const p of r.data.pares) {
    for (const [lado, item] of [
      ['a', p.a],
      ['b', p.b],
    ] as const) {
      if (item.tipo !== 'principio_ativo') continue;
      const k = item.nome.trim().toLowerCase();
      if (vistos.has(k)) continue;
      vistos.add(k);
      saida.push({ id: `${p.id}:${lado}`, nome: item.nome.trim() });
    }
  }
  return saida;
}

export interface OpcoesEntrada {
  /** Arquivo de decisões (padrão: data/mapeamento/decisoes.json). */
  decisoes?: string;
  /** Conjunto de referência (padrão: data/reference-set/pairs.json). */
  referencia?: string;
}

export interface Versoes {
  anvisa?: string;
  ddinter?: string;
  site?: string;
  pares?: string;
  manejo?: string;
}

/** Lê as cinco saídas processadas (ANVISA, DDInter CSVs, site, pares, manejo) de `<raiz>/data/processed`. */
export function lerEntradas(
  raiz: string,
  versoes: Versoes = {},
  opcoes: OpcoesEntrada = {},
): Entradas {
  const an = localizar(raiz, 'anvisa', relatorioAnvisa, versoes.anvisa);
  const cs = localizar(raiz, 'ddinter', relatorioDdinter, versoes.ddinter);
  const st = localizar(raiz, 'ddinter-site', relatorioSite, versoes.site);
  const pr = localizar(raiz, 'ddinter-pares', relatorioPares, versoes.pares);
  const mj = localizar(raiz, 'ddinter-manejo', relatorioManejo, versoes.manejo);
  const decisoes = lerDecisoes(opcoes.decisoes ?? join(raiz, CAMINHO_DECISOES));
  return {
    mapeamento: {
      decisoes,
      referencia: lerNomesDaReferencia(opcoes.referencia ?? join(raiz, CAMINHO_REFERENCIA)),
    },
    anvisa: {
      fonte: an.fonte,
      registros: lerJsonl(join(an.pasta, 'registros.jsonl'), registroAnvisa),
    },
    csv: {
      fonte: cs.fonte,
      interacoes: lerJsonl(join(cs.pasta, 'interacoes.jsonl'), interacaoCsv),
      farmacos: lerJsonl(join(cs.pasta, 'farmacos.jsonl'), farmacoCsv),
    },
    site: {
      fonte: st.fonte,
      textos: lerJsonl(join(st.pasta, 'textos-interacao.jsonl'), textoSite),
      alimentos: lerJsonl(join(st.pasta, 'alimentos.jsonl'), alimentoSite),
      doencas: lerJsonl(join(st.pasta, 'doencas.jsonl'), doencaSite),
      duplicidade: lerJsonl(join(st.pasta, 'duplicidade.jsonl'), duplicidadeSite),
    },
    pares: {
      fonte: pr.fonte,
      pares: lerJsonl(join(pr.pasta, 'pares.jsonl'), parSite),
      farmacos: lerJsonl(join(pr.pasta, 'farmacos.jsonl'), farmacoPares),
    },
    manejo: {
      fonte: mj.fonte,
      textos: lerJsonl(join(mj.pasta, 'textos-manejo.jsonl'), textoManejo),
      alternativas: lerJsonl(join(mj.pasta, 'alternativas.jsonl'), alternativasPar),
    },
  };
}
