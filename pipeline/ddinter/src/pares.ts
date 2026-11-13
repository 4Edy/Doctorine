import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { lerFeitos, NOME_CONFIG, type RespostaColetada } from './coletor.js';
import { ErroArquivo } from './processar.js';
import { distribuicao, jsonl, pct, tabela } from './saida.js';
import type { Nivel } from './schema.js';

export const FONTE_PARES_ID = 'ddinter-site-lista-de-pares';
export const NOME_BRUTO = 'pares-brutos.jsonl';
const NOME_MANIFESTO = 'manifesto.json';
const MAX_AMOSTRA = 10;
const NIVEL: Record<string, Nivel> = { '3': 'Major', '2': 'Moderate', '1': 'Minor' };
const MECANISMOS = [
  ['absorption', 'Absorption'],
  ['antagonistic_effect', 'Antagonism'],
  ['distribution', 'Distribution'],
  ['excretion', 'Excretion'],
  ['metabolism', 'Metabolism'],
  ['others', 'Others'],
  ['synergistic_effect', 'Synergy'],
] as const;

// ---- finalizar: da pasta de trabalho para um conjunto versionado ----
export interface ManifestoPares {
  fonte: string;
  origem: 'coleta';
  /** Maior data de coleta entre as respostas (AAAA-MM-DD). */
  baixadoEm: string;
  sha256: string;
  bytes: number;
  baseUrl: string;
  userAgent: string;
  intervaloMs: number;
  idsPedidos: {
    de: number;
    ate: number;
    total: number;
    comPares: number;
    semPares: number;
    naoEncontrados: number;
  };
}

export interface ResultadoFinalizar {
  diretorio: string;
  manifesto: ManifestoPares;
  novo: boolean;
}

/**
 * Fecha a coleta: exige todos os ids do intervalo, grava `pares-brutos.jsonl` ordenado por id de
 * texto (o mesmo conteúdo gera o mesmo checksum) e o manifesto em `<destino>/<sha12>/`.
 */
export function finalizarColeta(opcoes: {
  pasta: string;
  destino: string;
  de?: number;
  ate?: number;
}): ResultadoFinalizar {
  const caminhoConfig = join(opcoes.pasta, NOME_CONFIG);
  if (!existsSync(caminhoConfig))
    throw new ErroArquivo(`nenhuma coleta em ${opcoes.pasta}; rode "coletar-pares" antes`);
  const config = JSON.parse(readFileSync(caminhoConfig, 'utf8')) as {
    baseUrl: string;
    de: number;
    ate: number;
    userAgent: string;
    intervaloMs: number;
  };
  const de = opcoes.de ?? config.de;
  const ate = opcoes.ate ?? config.ate;
  const feitos = lerFeitos(opcoes.pasta);
  const faltam: number[] = [];
  const respostas: RespostaColetada[] = [];
  for (let id = de; id <= ate; id++) {
    const r = feitos.get(id);
    if (r === undefined) faltam.push(id);
    else respostas.push(r);
  }
  if (faltam.length > 0) {
    throw new ErroArquivo(
      `a coleta está incompleta: faltam ${faltam.length} ids de ${de} a ${ate} (primeiros: ${faltam.slice(0, 5).join(', ')}); rode "coletar-pares" de novo`,
    );
  }
  const conteudo = jsonl(respostas);
  const sha = createHash('sha256').update(conteudo).digest('hex');
  const diretorio = join(opcoes.destino, sha.slice(0, 12));
  if (existsSync(join(diretorio, NOME_MANIFESTO))) {
    return {
      diretorio,
      manifesto: JSON.parse(
        readFileSync(join(diretorio, NOME_MANIFESTO), 'utf8'),
      ) as ManifestoPares,
      novo: false,
    };
  }
  const manifesto: ManifestoPares = {
    fonte: FONTE_PARES_ID,
    origem: 'coleta',
    baixadoEm:
      respostas
        .map((r) => r.coletadoEm)
        .sort()
        .at(-1) ?? '',
    sha256: sha,
    bytes: Buffer.byteLength(conteudo),
    baseUrl: config.baseUrl,
    userAgent: config.userAgent,
    intervaloMs: config.intervaloMs,
    idsPedidos: {
      de,
      ate,
      total: respostas.length,
      comPares: respostas.filter((r) => r.status === 200 && r.total > 0).length,
      semPares: respostas.filter((r) => r.status === 200 && r.total === 0).length,
      naoEncontrados: respostas.filter((r) => r.status === 404).length,
    },
  };
  mkdirSync(diretorio, { recursive: true });
  writeFileSync(join(diretorio, NOME_BRUTO), conteudo, 'utf8');
  writeFileSync(join(diretorio, NOME_MANIFESTO), JSON.stringify(manifesto, null, 2) + '\n', 'utf8');
  return { diretorio, manifesto, novo: true };
}

// ---- processar ----
const idFarmaco = z.string().regex(/^DDInter\d+$/, 'identificador fora do formato DDInter<número>');
const flag = z.enum(['0', '1'], { error: 'esperado 0 ou 1' });
const linhaSchema = z.object({
  level: z.coerce.string().pipe(z.enum(['1', '2', '3'], { error: 'nível fora de 1, 2 e 3' })),
  drugbankID_a: z.string(),
  internalID_a: idFarmaco,
  drug_a_name: z.string().trim().min(1, 'vazio'),
  drugbankID_b: z.string(),
  internalID_b: idFarmaco,
  drug_b_name: z.string().trim().min(1, 'vazio'),
  id: z.number().int().nonnegative(),
  absorption: flag,
  antagonistic_effect: flag,
  distribution: flag,
  excretion: flag,
  metabolism: flag,
  others: flag,
  synergistic_effect: flag,
});

export interface ProvenienciaPares {
  fonte: string;
  versao: string;
  data: string;
  /** Texto de interação (id de `textos-interacao.jsonl`) a que este par pertence. */
  idTexto: number;
  /** Posição da linha na resposta do site para esse texto (base 1). */
  posicao: number;
}
export interface ParSite {
  /** Id do par no site (`/server/interact/<idPar>/`). */
  idPar: number;
  idTexto: number;
  nivel: Nivel;
  mecanismos: string[];
  /** Menor identificador numérico primeiro. */
  a: { id: string; drugbank: string | null; nome: string };
  b: { id: string; drugbank: string | null; nome: string };
  proveniencia: ProvenienciaPares;
}
export interface FarmacoSite {
  id: string;
  drugbank: string | null;
  nome: string;
  pares: number;
}
export interface RejeicaoPares {
  idTexto: number;
  posicao: number;
  motivos: string[];
  bruto: unknown;
}
export interface AvisoPares {
  idTexto: number;
  tipo: 'drugbank-divergente' | 'nome-divergente' | 'nivel-diferente-do-texto';
  detalhe: string;
}

/** Dados de fora desta fonte, para conferir. Opcionais: sem eles, a conferência é pulada. */
export interface ContextoPares {
  /** id do texto → nível (de `textos-interacao.jsonl`). */
  nivelDoTexto?: ReadonlyMap<number, Nivel>;
  /** "idA|idB" (menor primeiro) → nível original nos 8 CSVs de pares. */
  paresCsv?: ReadonlyMap<string, Nivel>;
}

export interface RelatorioPares {
  fonte: { id: string; sha256: string; versao: string; baixadoEm: string; baseUrl: string };
  idsPedidos: ManifestoPares['idsPedidos'];
  linhas: number;
  rejeitados: { total: number; amostra: RejeicaoPares[] };
  avisos: { total: number; porTipo: Record<string, number>; amostra: AvisoPares[] };
  pares: {
    registros: number;
    idsDePar: number;
    paresDeMedicamentos: number;
    /** Mesmo id de par em mais de um texto. */
    idParEmVariosTextos: number;
    /** Mesmo par de medicamentos com mais de um id de par. */
    paresComVariosIds: number;
    porNivel: Record<string, number>;
    paresPorTexto: Record<string, number>;
    maiorTexto: { idTexto: number; pares: number };
    semDrugbank: number;
  };
  farmacos: { total: number };
  conferencia: {
    textosComNivel: boolean;
    nivelDiferenteDoTexto: number | null;
    csv: null | {
      paresNoCsv: number;
      emAmbos: number;
      soNaColeta: number;
      soNoCsv: number;
      mesmoNivel: number;
      nivelDiferente: number;
      /** Pares do CSV com nível Unknown, que o site classifica de outro jeito ou nem lista. */
      csvUnknownNaColeta: number;
    };
  };
}

export interface ResultadoPares {
  pares: ParSite[];
  farmacos: FarmacoSite[];
  rejeicoes: RejeicaoPares[];
  avisos: AvisoPares[];
  relatorio: RelatorioPares;
}

const numero = (id: string): number => Number(id.slice('DDInter'.length));
const contar = (d: Record<string, number>, k: string): void => {
  d[k] = (d[k] ?? 0) + 1;
};

export function processarPares(
  entrada: { bytes: Uint8Array; manifesto: ManifestoPares },
  contexto: ContextoPares = {},
): ResultadoPares {
  const sha = createHash('sha256').update(entrada.bytes).digest('hex');
  if (sha !== entrada.manifesto.sha256) {
    throw new ErroArquivo(
      `checksum não confere: manifesto diz ${entrada.manifesto.sha256.slice(0, 12)}, o arquivo tem ${sha.slice(0, 12)}`,
    );
  }
  const versao = sha.slice(0, 12);
  const pares: ParSite[] = [];
  const rejeicoes: RejeicaoPares[] = [];
  const avisos: AvisoPares[] = [];
  const farmacos = new Map<string, { drugbank: string | null; nome: string; pares: number }>();
  let linhas = 0;
  const texto = Buffer.from(entrada.bytes).toString('utf8');

  for (const l of texto.split('\n')) {
    if (l.trim() === '') continue;
    const r = JSON.parse(l) as RespostaColetada;
    r.linhas.forEach((bruto, i) => {
      linhas++;
      const v = linhaSchema.safeParse(bruto);
      if (!v.success) {
        rejeicoes.push({
          idTexto: r.idTexto,
          posicao: i + 1,
          motivos: v.error.issues.map((x) => `${String(x.path[0] ?? '(linha)')}: ${x.message}`),
          bruto,
        });
        return;
      }
      const d = v.data;
      if (d.internalID_a === d.internalID_b) {
        rejeicoes.push({
          idTexto: r.idTexto,
          posicao: i + 1,
          motivos: ['internalID_b: o medicamento interage consigo mesmo'],
          bruto,
        });
        return;
      }
      const lado = (id: string, dbk: string, nome: string) => ({
        id,
        drugbank: dbk.trim() === '' ? null : dbk.trim(),
        nome,
      });
      let a = lado(d.internalID_a, d.drugbankID_a, d.drug_a_name);
      let b = lado(d.internalID_b, d.drugbankID_b, d.drug_b_name);
      if (numero(a.id) > numero(b.id)) [a, b] = [b, a];
      const nivel = NIVEL[d.level] as Nivel;
      const nivelTexto = contexto.nivelDoTexto?.get(r.idTexto);
      if (nivelTexto !== undefined && nivelTexto !== nivel) {
        avisos.push({
          idTexto: r.idTexto,
          tipo: 'nivel-diferente-do-texto',
          detalhe: `par ${d.id}: nível ${nivel} no par, ${nivelTexto} no texto ${r.idTexto}`,
        });
      }
      for (const x of [a, b]) {
        const f = farmacos.get(x.id);
        if (f === undefined) farmacos.set(x.id, { drugbank: x.drugbank, nome: x.nome, pares: 1 });
        else {
          f.pares++;
          if (f.drugbank !== x.drugbank) {
            avisos.push({
              idTexto: r.idTexto,
              tipo: 'drugbank-divergente',
              detalhe: `${x.id}: ${x.drugbank ?? '(vazio)'} aqui, ${f.drugbank ?? '(vazio)'} antes; mantido o primeiro`,
            });
          }
          if (f.nome !== x.nome) {
            avisos.push({
              idTexto: r.idTexto,
              tipo: 'nome-divergente',
              detalhe: `${x.id}: "${x.nome}" aqui, "${f.nome}" antes; mantido o primeiro`,
            });
          }
        }
      }
      pares.push({
        idPar: d.id,
        idTexto: r.idTexto,
        nivel,
        mecanismos: MECANISMOS.filter(([c]) => d[c] === '1').map(([, n]) => n),
        a,
        b,
        proveniencia: {
          fonte: FONTE_PARES_ID,
          versao,
          data: entrada.manifesto.baixadoEm,
          idTexto: r.idTexto,
          posicao: i + 1,
        },
      });
    });
  }
  pares.sort((x, y) => x.idPar - y.idPar || x.idTexto - y.idTexto);

  const porIdPar = new Map<number, Set<number>>();
  const porParMed = new Map<string, Set<number>>();
  const porTexto = new Map<number, number>();
  const porNivel: Record<string, number> = {};
  for (const p of pares) {
    (porIdPar.get(p.idPar) ?? porIdPar.set(p.idPar, new Set()).get(p.idPar)!).add(p.idTexto);
    (
      porParMed.get(`${p.a.id}|${p.b.id}`) ??
      porParMed.set(`${p.a.id}|${p.b.id}`, new Set()).get(`${p.a.id}|${p.b.id}`)!
    ).add(p.idPar);
    porTexto.set(p.idTexto, (porTexto.get(p.idTexto) ?? 0) + 1);
    contar(porNivel, p.nivel);
  }
  const faixa = (n: number): string =>
    n === 1
      ? '1'
      : n <= 10
        ? '2 a 10'
        : n <= 100
          ? '11 a 100'
          : n <= 1000
            ? '101 a 1000'
            : 'mais de 1000';
  const paresPorTexto: Record<string, number> = {};
  for (const n of porTexto.values()) contar(paresPorTexto, faixa(n));
  const [maiorId, maiorN] = [...porTexto.entries()].sort(
    (x, y) => y[1] - x[1] || x[0] - y[0],
  )[0] ?? [0, 0];

  const lista: FarmacoSite[] = [...farmacos.entries()]
    .sort(([x], [y]) => numero(x) - numero(y))
    .map(([id, f]) => ({ id, drugbank: f.drugbank, nome: f.nome, pares: f.pares }));

  const porTipo: Record<string, number> = {};
  const amostraAv: AvisoPares[] = [];
  for (const a of avisos) {
    contar(porTipo, a.tipo);
    if ((porTipo[a.tipo] as number) <= MAX_AMOSTRA) amostraAv.push(a);
  }

  let csv: RelatorioPares['conferencia']['csv'] = null;
  if (contexto.paresCsv !== undefined) {
    const coletados = new Map<string, Nivel>();
    for (const p of pares) {
      const k = `${p.a.id}|${p.b.id}`;
      const atual = coletados.get(k);
      const ordem: Record<Nivel, number> = { Major: 3, Moderate: 2, Minor: 1, Unknown: 0 };
      if (atual === undefined || ordem[p.nivel] > ordem[atual]) coletados.set(k, p.nivel);
    }
    let emAmbos = 0;
    let mesmo = 0;
    let dif = 0;
    let unknownNaColeta = 0;
    for (const [k, n] of contexto.paresCsv) {
      const c = coletados.get(k);
      if (c === undefined) continue;
      emAmbos++;
      if (n === c) mesmo++;
      else dif++;
      if (n === 'Unknown') unknownNaColeta++;
    }
    csv = {
      paresNoCsv: contexto.paresCsv.size,
      emAmbos,
      soNaColeta: coletados.size - emAmbos,
      soNoCsv: contexto.paresCsv.size - emAmbos,
      mesmoNivel: mesmo,
      nivelDiferente: dif,
      csvUnknownNaColeta: unknownNaColeta,
    };
  }

  const relatorio: RelatorioPares = {
    fonte: {
      id: FONTE_PARES_ID,
      sha256: sha,
      versao,
      baixadoEm: entrada.manifesto.baixadoEm,
      baseUrl: entrada.manifesto.baseUrl,
    },
    idsPedidos: entrada.manifesto.idsPedidos,
    linhas,
    rejeitados: { total: rejeicoes.length, amostra: rejeicoes.slice(0, MAX_AMOSTRA) },
    avisos: { total: avisos.length, porTipo, amostra: amostraAv },
    pares: {
      registros: pares.length,
      idsDePar: porIdPar.size,
      paresDeMedicamentos: porParMed.size,
      idParEmVariosTextos: [...porIdPar.values()].filter((s) => s.size > 1).length,
      paresComVariosIds: [...porParMed.values()].filter((s) => s.size > 1).length,
      porNivel,
      paresPorTexto,
      maiorTexto: { idTexto: maiorId, pares: maiorN },
      semDrugbank: lista.filter((f) => f.drugbank === null).length,
    },
    farmacos: { total: lista.length },
    conferencia: {
      textosComNivel: contexto.nivelDoTexto !== undefined,
      nivelDiferenteDoTexto:
        contexto.nivelDoTexto === undefined ? null : (porTipo['nivel-diferente-do-texto'] ?? 0),
      csv,
    },
  };
  return { pares, farmacos: lista, rejeicoes, avisos, relatorio };
}

export function relatorioParesEmMarkdown(r: RelatorioPares): string {
  const p = r.pares;
  const c = r.conferencia;
  const partes = [
    '# Relatório de qualidade: DDInter 2.0, lista de pares por texto',
    tabela(
      ['Item', 'Valor'],
      [
        ['Versão (SHA-256, 12 primeiros)', `\`${r.fonte.versao}\``],
        ['SHA-256', `\`${r.fonte.sha256}\``],
        ['Coletado até', r.fonte.baixadoEm],
        ['Site', r.fonte.baseUrl],
      ],
    ),
    '## Coleta',
    tabela(
      ['Ids de texto pedidos', 'Com pares', 'Sem pares', 'Não encontrados (404)', 'Faixa'],
      [
        [
          r.idsPedidos.total,
          r.idsPedidos.comPares,
          r.idsPedidos.semPares,
          r.idsPedidos.naoEncontrados,
          `${r.idsPedidos.de} a ${r.idsPedidos.ate}`,
        ],
      ],
    ),
    `Linhas recebidas: ${r.linhas}. Registros válidos: ${p.registros}. Rejeitadas: ${r.rejeitados.total}.`,
    '## Pares',
    tabela(
      ['Item', 'Valor'],
      [
        ['Registros (par + texto)', p.registros],
        ['Ids de par distintos', p.idsDePar],
        ['Pares de medicamentos distintos', p.paresDeMedicamentos],
        ['Id de par em mais de um texto', p.idParEmVariosTextos],
        ['Par de medicamentos com mais de um id', p.paresComVariosIds],
        ['Medicamentos', r.farmacos.total],
        ['Medicamentos sem DrugBank', p.semDrugbank],
        ['Maior texto', `${p.maiorTexto.idTexto} (${p.maiorTexto.pares} pares)`],
      ],
    ),
    distribuicao('Nível (do par)', p.porNivel, 'Registros'),
    distribuicao('Pares por texto', p.paresPorTexto, 'Textos'),
    '## Conferência',
    c.textosComNivel
      ? `Nível do par diferente do nível do texto: ${c.nivelDiferenteDoTexto}.`
      : 'Não conferido com os textos (rode `processar-site` antes).',
    c.csv === null
      ? 'Não conferido com os 8 CSVs de pares (rode `importar` e `processar` antes).'
      : [
          tabela(
            [
              'Pares nos 8 CSVs',
              'Em ambos',
              'Só na coleta',
              'Só nos CSVs',
              'Mesmo nível',
              'Nível diferente',
            ],
            [
              [
                c.csv.paresNoCsv,
                c.csv.emAmbos,
                c.csv.soNaColeta,
                c.csv.soNoCsv,
                c.csv.mesmoNivel,
                c.csv.nivelDiferente,
              ],
            ],
          ),
          `“Só na coleta” são pares que os 8 CSVs não têm (${pct(c.csv.soNaColeta, p.paresDeMedicamentos)} dos pares coletados). Dos pares dos CSVs com nível \`Unknown\`, ${c.csv.csvUnknownNaColeta} aparecem na coleta.`,
        ].join('\n\n'),
    '## Rejeições',
    r.rejeitados.total === 0
      ? 'Nenhuma linha rejeitada.'
      : tabela(
          ['Texto', 'Posição', 'Motivos'],
          r.rejeitados.amostra.map((a) => [a.idTexto, a.posicao, a.motivos.join('; ')]),
        ),
    '## Avisos',
    r.avisos.total === 0
      ? 'Nenhum aviso.'
      : [
          distribuicao('Tipo', r.avisos.porTipo),
          tabela(
            ['Texto', 'Tipo', 'Detalhe'],
            r.avisos.amostra.map((a) => [a.idTexto, a.tipo, a.detalhe]),
          ),
        ].join('\n\n'),
  ];
  return partes.join('\n\n') + '\n';
}

export function serializarPares(res: ResultadoPares): Record<string, string> {
  return {
    'pares.jsonl': jsonl(res.pares),
    'farmacos.jsonl': jsonl(res.farmacos),
    'rejeicoes.jsonl': jsonl(res.rejeicoes),
    'avisos.jsonl': jsonl(res.avisos),
    'relatorio-qualidade.json': JSON.stringify(res.relatorio, null, 2) + '\n',
    'relatorio-qualidade.md': relatorioParesEmMarkdown(res.relatorio),
  };
}

export function processarParesGuardado(
  diretorioBruto: string,
  saida: string,
  contexto: ContextoPares = {},
) {
  const manifesto = JSON.parse(
    readFileSync(join(diretorioBruto, NOME_MANIFESTO), 'utf8'),
  ) as ManifestoPares;
  const bytes = readFileSync(join(diretorioBruto, NOME_BRUTO));
  const resultado = processarPares({ bytes, manifesto }, contexto);
  const diretorioSaida = join(saida, resultado.relatorio.fonte.versao);
  mkdirSync(diretorioSaida, { recursive: true });
  const conteudo = serializarPares(resultado);
  for (const [nome, t] of Object.entries(conteudo))
    writeFileSync(join(diretorioSaida, nome), t, 'utf8');
  return { manifesto, diretorioSaida, resultado };
}
