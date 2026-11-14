import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

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

export interface Entradas {
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

export interface Versoes {
  anvisa?: string;
  ddinter?: string;
  site?: string;
  pares?: string;
  manejo?: string;
}

/** Lê as cinco saídas processadas (ANVISA, DDInter CSVs, site, pares, manejo) de `<raiz>/data/processed`. */
export function lerEntradas(raiz: string, versoes: Versoes = {}): Entradas {
  const an = localizar(raiz, 'anvisa', relatorioAnvisa, versoes.anvisa);
  const cs = localizar(raiz, 'ddinter', relatorioDdinter, versoes.ddinter);
  const st = localizar(raiz, 'ddinter-site', relatorioSite, versoes.site);
  const pr = localizar(raiz, 'ddinter-pares', relatorioPares, versoes.pares);
  const mj = localizar(raiz, 'ddinter-manejo', relatorioManejo, versoes.manejo);
  return {
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
