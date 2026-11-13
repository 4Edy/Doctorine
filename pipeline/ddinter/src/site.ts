import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { lerCsv } from './csv.js';
import { ErroArquivo, versaoDoConjunto, type Aviso, type Rejeicao } from './processar.js';
import type { CategoriaRejeicao } from './processar.js';
import type { Nivel } from './schema.js';

/**
 * Exportações do site DDInter 2.0 (ddinter2.scbdd.com), baixadas à mão em 2026-11-12: os textos
 * das interações entre medicamentos (por gravidade), as interações com alimentos, com doenças e a
 * duplicidade terapêutica. Complementam os 8 CSVs de pares (`ddinter_downloads_code_*`), que só
 * têm a gravidade. Ver docs/fontes/ddinter.md.
 */
export const FONTE_SITE_ID = 'ddinter-site-exportacoes';
const MAX_AMOSTRA = 10;

export const TIPOS_SITE = [
  'severity_1',
  'severity_2',
  'severity_3',
  'drug_food',
  'drug_disease',
  'therapeutic_duplication',
] as const;
export type TipoSite = (typeof TIPOS_SITE)[number];

export const nomeArquivoSite = (tipo: string): string => `${tipo}.csv`;

/** Reconhece o arquivo mesmo com prefixo (por exemplo, "3e59dc25-severity_3.csv"). */
export const tipoDoArquivoSite = (nome: string): TipoSite | null => {
  const m = /(?:^|[-_ ])(severity_[123]|drug_food|drug_disease|therapeutic_duplication)\.csv$/.exec(
    nome,
  );
  return (m?.[1] as TipoSite | undefined) ?? null;
};

export const COLUNAS_SITE: Record<TipoSite, readonly string[]> = {
  severity_1: [
    'id',
    'level',
    'interaction',
    'absorption',
    'antagonistic_effect',
    'distribution',
    'excretion',
    'metabolism',
    'others',
    'synergistic_effect',
    'severity_filter',
  ],
  severity_2: [],
  severity_3: [],
  drug_food: [
    'id',
    'drugName',
    'foodName',
    'internalID_a_id',
    'level',
    'references',
    'newInteraction',
    'newManagement',
    'magnesium',
  ],
  drug_disease: ['id', 'drugName', 'diseaseName', 'internalID_a_id', 'level', 'references', 'text'],
  therapeutic_duplication: [
    'drugmulti_trade',
    'drugmulti',
    'drugtype',
    'drugb',
    'internalID_b_id',
    'warning',
    'note',
  ],
};
COLUNAS_SITE.severity_2 = COLUNAS_SITE.severity_1;
COLUNAS_SITE.severity_3 = COLUNAS_SITE.severity_1;

/** No site, o código 3 é a gravidade mais alta. Confere com o par de exemplo (id 9, "Major"). */
const NIVEL_DO_CODIGO: Record<string, Nivel> = { '3': 'Major', '2': 'Moderate', '1': 'Minor' };
/** Arquivo severity_N guarda o código (4 - N): severity_1 = Major (3), 2 = Moderate (2), 3 = Minor (1). */
const CODIGO_DO_ARQUIVO: Record<string, string> = {
  severity_1: '3',
  severity_2: '2',
  severity_3: '1',
};

const MECANISMOS = [
  ['absorption', 'Absorption'],
  ['antagonistic_effect', 'Antagonism'],
  ['distribution', 'Distribution'],
  ['excretion', 'Excretion'],
  ['metabolism', 'Metabolism'],
  ['others', 'Others'],
  ['synergistic_effect', 'Synergy'],
] as const;

export interface ProvenienciaSite {
  fonte: string;
  versao: string;
  data: string;
  arquivo: string;
  linha: number;
}

export interface TextoInteracao {
  id: number;
  nivel: Nivel;
  /** Texto original do site (inglês). null quando vem vazio. */
  texto: string | null;
  /** Mecanismos marcados no site; vazio quando nenhum está marcado. */
  mecanismos: string[];
  proveniencia: ProvenienciaSite;
}

export interface RegistroAlimento {
  id: number;
  idFarmaco: string;
  farmaco: string;
  alimento: string;
  nivel: Nivel;
  /** Coluna `magnesium` do arquivo, que na verdade é o mecanismo. null quando vazia. */
  mecanismo: string | null;
  interacao: string;
  manejo: string;
  /** Referências como vieram (separadas por "|"); podem ter perdido acentos na origem. */
  referencias: string | null;
  proveniencia: ProvenienciaSite;
}

export interface RegistroDoenca {
  id: number;
  idFarmaco: string;
  farmaco: string;
  doenca: string;
  nivel: Nivel;
  texto: string;
  referencias: string | null;
  proveniencia: ProvenienciaSite;
}

export interface RegistroDuplicidade {
  produto: string;
  composicao: string;
  classe: string;
  idFarmaco: string;
  farmaco: string;
  aviso: string;
  nota: string;
  proveniencia: ProvenienciaSite;
}

export interface AvisoSite extends Omit<Aviso, 'tipo'> {
  tipo: 'texto-vazio' | 'sem-mecanismo' | 'mecanismo-vazio' | 'espaco-removido';
}
export type RejeicaoSite = Omit<Rejeicao, 'categoria'> & {
  categoria: CategoriaRejeicao | 'id-repetido';
};

export interface RelatorioSite {
  fonte: { id: string; origem: 'manual'; sha256: string; versao: string; baixadoEm: string };
  arquivos: Array<{
    tipo: string;
    arquivo: string;
    sha256: string;
    bytes: number;
    linhasLidas: number;
    rejeitadas: number;
    registros: number;
  }>;
  rejeitados: {
    total: number;
    porCategoria: Record<string, number>;
    amostra: Array<Pick<RejeicaoSite, 'arquivo' | 'linha' | 'categoria' | 'motivos'>>;
  };
  avisos: { total: number; porTipo: Record<string, number>; amostra: AvisoSite[] };
  textosInteracao: {
    total: number;
    distintos: number;
    porNivel: Record<string, number>;
    porMecanismo: Record<string, number>;
    comMaisDeUmMecanismo: number;
    semMecanismo: number;
    idMinimo: number;
    idMaximo: number;
    /** Ids entre o mínimo e o máximo que não estão em nenhum dos 3 arquivos. */
    idsAusentes: number;
  };
  alimentos: GrupoRelatorio & { alimentos: number; porMecanismo: Record<string, number> };
  doencas: GrupoRelatorio & { doencas: number };
  duplicidade: {
    total: number;
    produtos: number;
    classes: number;
    farmacos: number;
    exatasRepetidas: number;
  };
  farmacos: {
    /** Identificadores DDInter distintos nos 3 arquivos de medicamento + alimento/doença/duplicidade. */
    distintos: number;
    nomesDivergentes: Array<{ id: string; nomes: string[] }>;
  };
  suspeitaPerdaDeCaractere: Record<string, number>;
}

interface GrupoRelatorio {
  total: number;
  farmacos: number;
  porNivel: Record<string, number>;
  /** Mesmo medicamento + alimento (ou doença) com mais de um registro: não é erro. */
  chavesRepetidas: number;
  linhasExtras: number;
  chavesComNiveisDiferentes: number;
}

export interface ResultadoSite {
  textos: TextoInteracao[];
  alimentos: RegistroAlimento[];
  doencas: RegistroDoenca[];
  duplicidade: RegistroDuplicidade[];
  rejeicoes: RejeicaoSite[];
  avisos: AvisoSite[];
  relatorio: RelatorioSite;
}

export interface EntradaSite {
  arquivos: ReadonlyArray<{ tipo: string; bytes: Uint8Array }>;
  baixadoEm: string;
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const contar = (d: Record<string, number>, k: string): void => {
  d[k] = (d[k] ?? 0) + 1;
};
const suspeito = (v: string): boolean => v.includes('?') || v.includes('�');

// ---- esquemas por tipo ----
const obrigatorio = z.string().min(1, 'vazio');
const idNumerico = z.string().regex(/^\d+$/, 'id fora do formato (esperado número)');
const idFarmaco = z.string().regex(/^DDInter\d+$/, 'identificador fora do formato DDInter<número>');
const nivelSite = z.enum(['1', '2', '3'], { error: 'nível fora de 1, 2 e 3' });
const flag = z.enum(['0', '1'], { error: 'esperado 0 ou 1' });

const esquemaSeverity = z.object({
  id: idNumerico,
  level: nivelSite,
  interaction: z.string(),
  absorption: flag,
  antagonistic_effect: flag,
  distribution: flag,
  excretion: flag,
  metabolism: flag,
  others: flag,
  synergistic_effect: flag,
  severity_filter: z.enum(['1', '2', '3']),
});
const esquemaAlimento = z.object({
  id: idNumerico,
  drugName: obrigatorio,
  foodName: obrigatorio,
  internalID_a_id: idFarmaco,
  level: nivelSite,
  references: z.string(),
  newInteraction: obrigatorio,
  newManagement: obrigatorio,
  magnesium: z.string(),
});
const esquemaDoenca = z.object({
  id: idNumerico,
  drugName: obrigatorio,
  diseaseName: obrigatorio,
  internalID_a_id: idFarmaco,
  level: nivelSite,
  references: z.string(),
  text: obrigatorio,
});
const esquemaDuplicidade = z.object({
  drugmulti_trade: obrigatorio,
  drugmulti: obrigatorio,
  drugtype: obrigatorio,
  drugb: obrigatorio,
  internalID_b_id: idFarmaco,
  warning: obrigatorio,
  note: obrigatorio,
});

function validar<T extends z.ZodType>(
  esquema: T,
  colunas: readonly string[],
  campos: readonly string[],
): { ok: true; valor: z.infer<T> } | { ok: false; motivos: string[] } {
  const r = esquema.safeParse(Object.fromEntries(colunas.map((c, i) => [c, campos[i]])));
  if (r.success) return { ok: true, valor: r.data };
  return {
    ok: false,
    motivos: r.error.issues.map((i) => `${String(i.path[0] ?? '(linha)')}: ${i.message}`),
  };
}

function decodificar(bytes: Uint8Array, arquivo: string): string {
  let t: string;
  try {
    t = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ErroArquivo(`${arquivo} não é UTF-8 válido; não vou adivinhar a codificação`);
  }
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
}

const agrupar = <T>(itens: readonly T[], chave: (i: T) => string): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const i of itens) {
    const k = chave(i);
    const l = m.get(k);
    if (l === undefined) m.set(k, [i]);
    else l.push(i);
  }
  return m;
};

function resumirGrupo<T extends { idFarmaco: string; nivel: Nivel }>(
  regs: readonly T[],
  chave: (r: T) => string,
): GrupoRelatorio {
  const porNivel: Record<string, number> = {};
  for (const r of regs) contar(porNivel, r.nivel);
  const g = agrupar(regs, chave);
  let chavesRepetidas = 0;
  let linhasExtras = 0;
  let diferentes = 0;
  for (const v of g.values()) {
    if (v.length < 2) continue;
    chavesRepetidas++;
    linhasExtras += v.length - 1;
    if (new Set(v.map((x) => x.nivel)).size > 1) diferentes++;
  }
  return {
    total: regs.length,
    farmacos: new Set(regs.map((r) => r.idFarmaco)).size,
    porNivel,
    chavesRepetidas,
    linhasExtras,
    chavesComNiveisDiferentes: diferentes,
  };
}

export function processarSite(entrada: EntradaSite): ResultadoSite {
  const tipos = entrada.arquivos.map((a) => a.tipo).sort();
  const faltam = TIPOS_SITE.filter((t) => !tipos.includes(t));
  const sobram = tipos.filter((t) => !(TIPOS_SITE as readonly string[]).includes(t));
  const repetidos = tipos.filter((t, i) => tipos.indexOf(t) !== i);
  if (faltam.length > 0 || sobram.length > 0 || repetidos.length > 0) {
    throw new ErroArquivo(
      `conjunto incompleto ou com excesso: faltam [${faltam.join(', ')}], inesperados [${sobram.join(', ')}], repetidos [${repetidos.join(', ')}]`,
    );
  }
  const ordenados = TIPOS_SITE.map(
    (t) => entrada.arquivos.find((a) => a.tipo === t) as { tipo: TipoSite; bytes: Uint8Array },
  );
  const hashes = ordenados.map((a) => ({ letra: a.tipo, sha256: sha256(a.bytes) }));
  const conjunto = versaoDoConjunto(hashes);

  const textos: TextoInteracao[] = [];
  const alimentos: RegistroAlimento[] = [];
  const doencas: RegistroDoenca[] = [];
  const duplicidade: RegistroDuplicidade[] = [];
  const rejeicoes: RejeicaoSite[] = [];
  const avisos: AvisoSite[] = [];
  const porArquivo = new Map<string, { linhas: number; rejeitadas: number; registros: number }>();
  const idsTexto = new Set<number>();
  const idsAlimento = new Set<number>();
  const idsDoenca = new Set<number>();
  const exatas = new Set<string>();
  let exatasRepetidas = 0;
  const suspeita: Record<string, number> = {};

  for (const { tipo, bytes } of ordenados) {
    const arquivo = nomeArquivoSite(tipo);
    const [cabecalho, ...dados] = lerCsv(decodificar(bytes, arquivo), ',');
    if (cabecalho === undefined) throw new ErroArquivo(`${arquivo} está vazio`);
    const colunas = COLUNAS_SITE[tipo];
    if (cabecalho.campos.join(',') !== colunas.join(',')) {
      throw new ErroArquivo(
        `${arquivo}: cabeçalho diferente do esperado: esperado "${colunas.join(',')}", encontrado "${cabecalho.campos.join(',')}"`,
      );
    }
    if (dados.length === 0)
      throw new ErroArquivo(`${arquivo} tem só o cabeçalho, sem linhas de dados`);
    const estat = { linhas: dados.length, rejeitadas: 0, registros: 0 };
    porArquivo.set(tipo, estat);
    const rejeitar = (
      linha: number,
      categoria: RejeicaoSite['categoria'],
      motivos: string[],
      bruto: string[],
    ): void => {
      estat.rejeitadas++;
      rejeicoes.push({ arquivo, linha, categoria, motivos, bruto });
    };
    const prov = (linha: number): ProvenienciaSite => ({
      fonte: FONTE_SITE_ID,
      versao: conjunto.versao,
      data: entrada.baixadoEm,
      arquivo,
      linha,
    });
    const marcarSuspeita = (campo: string, valor: string): void => {
      if (suspeito(valor)) contar(suspeita, `${tipo}.${campo}`);
    };

    for (const reg of dados) {
      if (reg.erro !== undefined) {
        rejeitar(reg.linha, 'csv-malformado', [reg.erro], reg.campos);
        continue;
      }
      if (reg.campos.length !== colunas.length) {
        rejeitar(
          reg.linha,
          'colunas',
          [`${reg.campos.length} colunas, esperadas ${colunas.length}`],
          reg.campos,
        );
        continue;
      }
      // Espaço no começo ou no fim vem da origem (texto de alimento, nome de medicamento). Perder o
      // registro por isso seria pior: o espaço é removido e a linha vai para os avisos.
      const campos = reg.campos.map((c) => c.trim());
      const alterados = colunas.filter((_, i) => campos[i] !== reg.campos[i]);
      if (alterados.length > 0) {
        avisos.push({
          arquivo,
          linha: reg.linha,
          tipo: 'espaco-removido',
          detalhe: `espaço no começo ou no fim removido de: ${alterados.join(', ')}`,
        });
      }
      if (tipo === 'severity_1' || tipo === 'severity_2' || tipo === 'severity_3') {
        const v = validar(esquemaSeverity, colunas, campos);
        if (!v.ok) {
          rejeitar(reg.linha, 'esquema', v.motivos, reg.campos);
          continue;
        }
        const d = v.valor;
        const esperado = CODIGO_DO_ARQUIVO[tipo] as string;
        const filtroEsperado = tipo.slice(-1);
        if (d.level !== esperado || d.severity_filter !== filtroEsperado) {
          rejeitar(
            reg.linha,
            'esquema',
            [
              `level/severity_filter ${d.level}/${d.severity_filter} não combinam com ${arquivo} (esperado ${esperado}/${filtroEsperado})`,
            ],
            reg.campos,
          );
          continue;
        }
        const id = Number(d.id);
        if (idsTexto.has(id)) {
          rejeitar(reg.linha, 'id-repetido', [`id ${id} já apareceu em outra linha`], reg.campos);
          continue;
        }
        idsTexto.add(id);
        const mecanismos = MECANISMOS.filter(([campo]) => d[campo] === '1').map(([, nome]) => nome);
        const t = d.interaction;
        if (t === '') {
          avisos.push({
            arquivo,
            linha: reg.linha,
            tipo: 'texto-vazio',
            detalhe: `id ${id} sem texto de interação; mantido com texto nulo`,
          });
        }
        if (mecanismos.length === 0) {
          avisos.push({
            arquivo,
            linha: reg.linha,
            tipo: 'sem-mecanismo',
            detalhe: `id ${id} sem nenhum mecanismo marcado`,
          });
        }
        marcarSuspeita('interaction', d.interaction);
        textos.push({
          id,
          nivel: NIVEL_DO_CODIGO[d.level] as Nivel,
          texto: t === '' ? null : t,
          mecanismos,
          proveniencia: prov(reg.linha),
        });
        estat.registros++;
      } else if (tipo === 'drug_food') {
        const v = validar(esquemaAlimento, colunas, campos);
        if (!v.ok) {
          rejeitar(reg.linha, 'esquema', v.motivos, reg.campos);
          continue;
        }
        const d = v.valor;
        const id = Number(d.id);
        if (idsAlimento.has(id)) {
          rejeitar(reg.linha, 'id-repetido', [`id ${id} já apareceu em outra linha`], reg.campos);
          continue;
        }
        idsAlimento.add(id);
        const mecanismo = d.magnesium === '' ? null : d.magnesium;
        if (mecanismo === null) {
          avisos.push({
            arquivo,
            linha: reg.linha,
            tipo: 'mecanismo-vazio',
            detalhe: `id ${id} sem mecanismo`,
          });
        }
        marcarSuspeita('references', d.references);
        marcarSuspeita('newInteraction', d.newInteraction);
        alimentos.push({
          id,
          idFarmaco: d.internalID_a_id,
          farmaco: d.drugName,
          alimento: d.foodName,
          nivel: NIVEL_DO_CODIGO[d.level] as Nivel,
          mecanismo,
          interacao: d.newInteraction,
          manejo: d.newManagement,
          referencias: d.references === '' ? null : d.references,
          proveniencia: prov(reg.linha),
        });
        estat.registros++;
      } else if (tipo === 'drug_disease') {
        const v = validar(esquemaDoenca, colunas, campos);
        if (!v.ok) {
          rejeitar(reg.linha, 'esquema', v.motivos, reg.campos);
          continue;
        }
        const d = v.valor;
        const id = Number(d.id);
        if (idsDoenca.has(id)) {
          rejeitar(reg.linha, 'id-repetido', [`id ${id} já apareceu em outra linha`], reg.campos);
          continue;
        }
        idsDoenca.add(id);
        marcarSuspeita('references', d.references);
        marcarSuspeita('text', d.text);
        doencas.push({
          id,
          idFarmaco: d.internalID_a_id,
          farmaco: d.drugName,
          doenca: d.diseaseName,
          nivel: NIVEL_DO_CODIGO[d.level] as Nivel,
          texto: d.text,
          referencias: d.references === '' ? null : d.references,
          proveniencia: prov(reg.linha),
        });
        estat.registros++;
      } else {
        const v = validar(esquemaDuplicidade, colunas, campos);
        if (!v.ok) {
          rejeitar(reg.linha, 'esquema', v.motivos, reg.campos);
          continue;
        }
        const d = v.valor;
        const chave = JSON.stringify(campos);
        if (exatas.has(chave)) {
          exatasRepetidas++;
          continue;
        }
        exatas.add(chave);
        duplicidade.push({
          produto: d.drugmulti_trade,
          composicao: d.drugmulti,
          classe: d.drugtype,
          idFarmaco: d.internalID_b_id,
          farmaco: d.drugb,
          aviso: d.warning,
          nota: d.note,
          proveniencia: prov(reg.linha),
        });
        estat.registros++;
      }
    }
  }

  // índices alimentos/doenças: usar Map para a checagem de id é mais rápido, mas o volume é pequeno
  textos.sort((a, b) => a.id - b.id);
  alimentos.sort((a, b) => a.id - b.id);
  doencas.sort((a, b) => a.id - b.id);

  const rejeitados: RelatorioSite['rejeitados'] = {
    total: rejeicoes.length,
    porCategoria: {},
    amostra: [],
  };
  const vistas: Record<string, number> = {};
  for (const r of rejeicoes) {
    contar(rejeitados.porCategoria, r.categoria);
    contar(vistas, r.categoria);
    if ((vistas[r.categoria] as number) <= MAX_AMOSTRA) {
      rejeitados.amostra.push({
        arquivo: r.arquivo,
        linha: r.linha,
        categoria: r.categoria,
        motivos: r.motivos,
      });
    }
  }
  const porTipoAviso: Record<string, number> = {};
  const amostraAvisos: AvisoSite[] = [];
  for (const a of avisos) {
    contar(porTipoAviso, a.tipo);
    if ((porTipoAviso[a.tipo] as number) <= MAX_AMOSTRA) amostraAvisos.push(a);
  }

  const porNivel: Record<string, number> = {};
  const porMecanismo: Record<string, number> = {};
  for (const t of textos) {
    contar(porNivel, t.nivel);
    for (const m of t.mecanismos) contar(porMecanismo, m);
  }
  const ids = textos.map((t) => t.id);
  const idMinimo = ids.length === 0 ? 0 : Math.min(...ids);
  const idMaximo = ids.length === 0 ? 0 : Math.max(...ids);

  const nomes = new Map<string, Set<string>>();
  for (const r of [...alimentos, ...doencas, ...duplicidade]) {
    const s = nomes.get(r.idFarmaco) ?? new Set<string>();
    s.add(r.farmaco);
    nomes.set(r.idFarmaco, s);
  }
  const nomesDivergentes = [...nomes.entries()]
    .filter(([, s]) => s.size > 1)
    .sort(([a], [b]) => Number(a.slice(7)) - Number(b.slice(7)))
    .map(([id, s]) => ({ id, nomes: [...s].sort() }));

  const mecAlimento: Record<string, number> = {};
  for (const a of alimentos) contar(mecAlimento, a.mecanismo ?? '(vazio)');

  const relatorio: RelatorioSite = {
    fonte: {
      id: FONTE_SITE_ID,
      origem: 'manual',
      sha256: conjunto.sha256,
      versao: conjunto.versao,
      baixadoEm: entrada.baixadoEm,
    },
    arquivos: ordenados.map((a, i) => {
      const e = porArquivo.get(a.tipo) as { linhas: number; rejeitadas: number; registros: number };
      return {
        tipo: a.tipo,
        arquivo: nomeArquivoSite(a.tipo),
        sha256: (hashes[i] as { sha256: string }).sha256,
        bytes: a.bytes.byteLength,
        linhasLidas: e.linhas,
        rejeitadas: e.rejeitadas,
        registros: e.registros,
      };
    }),
    rejeitados,
    avisos: { total: avisos.length, porTipo: porTipoAviso, amostra: amostraAvisos },
    textosInteracao: {
      total: textos.length,
      distintos: new Set(textos.map((t) => t.texto)).size,
      porNivel,
      porMecanismo,
      comMaisDeUmMecanismo: textos.filter((t) => t.mecanismos.length > 1).length,
      semMecanismo: textos.filter((t) => t.mecanismos.length === 0).length,
      idMinimo,
      idMaximo,
      idsAusentes: ids.length === 0 ? 0 : idMaximo - idMinimo + 1 - new Set(ids).size,
    },
    alimentos: {
      ...resumirGrupo(alimentos, (r) => `${r.idFarmaco}|${r.alimento}`),
      alimentos: new Set(alimentos.map((a) => a.alimento)).size,
      porMecanismo: mecAlimento,
    },
    doencas: {
      ...resumirGrupo(doencas, (r) => `${r.idFarmaco}|${r.doenca}`),
      doencas: new Set(doencas.map((d) => d.doenca)).size,
    },
    duplicidade: {
      total: duplicidade.length,
      produtos: new Set(duplicidade.map((d) => d.produto)).size,
      classes: new Set(duplicidade.map((d) => d.classe)).size,
      farmacos: new Set(duplicidade.map((d) => d.idFarmaco)).size,
      exatasRepetidas,
    },
    farmacos: { distintos: nomes.size, nomesDivergentes },
    suspeitaPerdaDeCaractere: Object.fromEntries(Object.entries(suspeita).sort()),
  };
  return { textos, alimentos, doencas, duplicidade, rejeicoes, avisos, relatorio };
}

// ---- guardar / importar ----
export interface ManifestoSite {
  fonte: string;
  origem: 'manual';
  baixadoEm: string;
  sha256: string;
  arquivos: Array<{ tipo: string; arquivo: string; sha256: string; bytes: number }>;
}
const NOME_MANIFESTO = 'manifesto.json';

export interface ResultadoGuardarSite {
  diretorio: string;
  manifesto: ManifestoSite;
  novo: boolean;
}

export function lerManifestoSite(diretorio: string): ManifestoSite {
  const caminho = join(diretorio, NOME_MANIFESTO);
  try {
    return JSON.parse(readFileSync(caminho, 'utf8')) as ManifestoSite;
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro);
    throw new ErroArquivo(`manifesto ilegível em ${caminho}: ${motivo}`);
  }
}

/** Registra no pipeline as 6 exportações que o Edu baixou do site. */
export function importarSite(opcoes: {
  destino: string;
  pasta: string;
  agora?: () => Date;
}): ResultadoGuardarSite {
  const agora = opcoes.agora ?? (() => new Date());
  if (!existsSync(opcoes.pasta)) throw new ErroArquivo(`pasta não encontrada: ${opcoes.pasta}`);
  const achados: Array<{ tipo: TipoSite; bytes: Uint8Array }> = [];
  for (const nome of readdirSync(opcoes.pasta).sort()) {
    const tipo = tipoDoArquivoSite(nome);
    if (tipo !== null) achados.push({ tipo, bytes: readFileSync(join(opcoes.pasta, nome)) });
  }
  if (achados.length === 0) {
    throw new ErroArquivo(
      `nenhuma exportação do site (severity_*.csv, drug_food.csv...) em ${opcoes.pasta}`,
    );
  }
  const tipos = achados.map((a) => a.tipo);
  const faltam = TIPOS_SITE.filter((t) => !tipos.includes(t));
  const repetidos = tipos.filter((t, i) => tipos.indexOf(t) !== i);
  if (faltam.length > 0 || repetidos.length > 0) {
    throw new ErroArquivo(
      `conjunto incompleto: faltam [${faltam.join(', ')}], repetidos [${repetidos.join(', ')}]`,
    );
  }
  const itens = TIPOS_SITE.map((t) => {
    const a = achados.find((x) => x.tipo === t) as { tipo: TipoSite; bytes: Uint8Array };
    return {
      tipo: t,
      arquivo: nomeArquivoSite(t),
      sha256: sha256(a.bytes),
      bytes: a.bytes.byteLength,
    };
  });
  const conjunto = versaoDoConjunto(itens.map((i) => ({ letra: i.tipo, sha256: i.sha256 })));
  const diretorio = join(opcoes.destino, conjunto.versao);
  if (existsSync(join(diretorio, NOME_MANIFESTO))) {
    return { diretorio, manifesto: lerManifestoSite(diretorio), novo: false };
  }
  const manifesto: ManifestoSite = {
    fonte: FONTE_SITE_ID,
    origem: 'manual',
    baixadoEm: agora().toISOString().slice(0, 10),
    sha256: conjunto.sha256,
    arquivos: itens,
  };
  mkdirSync(diretorio, { recursive: true });
  for (const a of achados) writeFileSync(join(diretorio, nomeArquivoSite(a.tipo)), a.bytes);
  writeFileSync(join(diretorio, NOME_MANIFESTO), JSON.stringify(manifesto, null, 2) + '\n', 'utf8');
  return { diretorio, manifesto, novo: true };
}

export function ultimoSite(raiz: string): { diretorio: string; manifesto: ManifestoSite } {
  const candidatos = existsSync(raiz)
    ? readdirSync(raiz, { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(join(raiz, e.name, NOME_MANIFESTO)))
        .map((e) => ({
          diretorio: join(raiz, e.name),
          manifesto: lerManifestoSite(join(raiz, e.name)),
        }))
    : [];
  candidatos.sort(
    (a, b) =>
      (a.manifesto.baixadoEm < b.manifesto.baixadoEm
        ? 1
        : a.manifesto.baixadoEm > b.manifesto.baixadoEm
          ? -1
          : 0) || (a.manifesto.sha256 < b.manifesto.sha256 ? 1 : -1),
  );
  const [melhor] = candidatos;
  if (melhor === undefined) {
    throw new ErroArquivo(
      `nenhuma importação encontrada em ${raiz}; rode "importar-site <pasta>" antes`,
    );
  }
  return melhor;
}
