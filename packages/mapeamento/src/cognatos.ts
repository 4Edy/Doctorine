import { chaveDe } from './normalizar.js';

/**
 * Regras de grafia português → inglês, aplicadas a uma palavra sem acento. Cada regra é opcional:
 * a palavra original e todas as combinações viram candidatas, e o mapeamento automático só
 * aceita uma candidata que seja IDÊNTICA ao nome de um medicamento do DDInter. As regras só
 * geram candidatas; quem decide é a comparação exata (e, nos casos duvidosos, a farmacêutica).
 */
const REGRAS: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/ina$/, ['ine', 'in']],
  [/a$/, ['e']],
  [/ona$/, ['one', 'on']],
  [/ida$/, ['ide']],
  [/ido$/, ['ide']],
  [/eto$/, ['ide']],
  [/micina$/, ['mycin', 'micin']],
  [/^cefal/, ['cephal']],
  [/eritr/, ['erythr']],
  [/ol$/, ['ole']],
  [/ato$/, ['ate']],
  [/ico$/, ['ic']],
  [/ica$/, ['ic']],
  [/io$/, ['ium']],
  [/il(?=[a-z])/, ['yl']],
  [/ila$/, ['yl']],
  [/ilo$/, ['yl']],
  [/eno$/, ['ene', 'en']],
  [/ano$/, ['ane', 'an']],
  [/ana$/, ['an', 'ane']],
  [/ino$/, ['in', 'ine']],
  [/aco$/, ['ac']],
  [/ia$/, ['y']],
  [/^es(?=[ptc])/, ['s']],
  [/^fen/, ['phen']],
  [/fosf/, ['phosph']],
  [/fil/, ['phyl']],
  [/^hidr/, ['hydr']],
  [/clor/, ['chlor']],
  [/tiaz/, ['thiaz']],
  [/met/, ['meth']],
  [/^et/, ['eth']],
  [/^ceto/, ['keto']],
  [/^ci/, ['cy']],
  [/oxi/, ['oxy']],
  [/cil/, ['cill']],
  [/nv/, ['mv']],
  [/^teo/, ['theo']],
  [/ft/, ['pht']],
];

/** Palavras que não seguem as regras de grafia (elementos e adjetivos de sal). */
const IRREGULARES: Readonly<Record<string, readonly string[]>> = {
  zinco: ['zinc'],
  ferro: ['iron'],
  ferroso: ['ferrous'],
  ferrico: ['ferric'],
  cobre: ['copper'],
  prata: ['silver'],
  enxofre: ['sulfur', 'sulphur'],
  aluminio: ['aluminum', 'aluminium'],
};

/** "X de Y" (cloreto de sódio) vira "Y X" (sodium chloride) quando X é um destes ânions. */
const ANIONS: ReadonlySet<string> = new Set([
  'cloreto',
  'sulfato',
  'fosfato',
  'acetato',
  'citrato',
  'nitrato',
  'carbonato',
  'bicarbonato',
  'oxido',
  'hidroxido',
  'lactato',
  'gluconato',
  'iodeto',
  'brometo',
  'cloridrato',
  'bromidrato',
  'maleato',
  'fumarato',
  'succinato',
  'tartarato',
  'besilato',
  'mesilato',
  'valerato',
  'propionato',
]);

const MAX_POR_PALAVRA = 48;
const MAX_TOTAL = 256;

export function variantesDaPalavra(palavra: string): string[] {
  let conjunto = new Set([palavra, ...(IRREGULARES[palavra] ?? [])]);
  for (const [padrao, trocas] of REGRAS) {
    const novo = new Set(conjunto);
    for (const s of conjunto) {
      if (!padrao.test(s)) continue;
      for (const t of trocas) {
        novo.add(s.replace(new RegExp(padrao.source, 'g'), t));
        if (novo.size >= MAX_POR_PALAVRA) break;
      }
    }
    conjunto = novo;
  }
  return [...conjunto].sort();
}

/**
 * Candidatas em inglês para um nome em português (já normalizado com `chaveDe`). "ácido X-ico"
 * também vira "X-ic acid". O resultado é ordenado, então a mesma entrada dá a mesma saída.
 */
export function variantesEmIngles(chave: string): string[] {
  const reordenadas = variantesComAnion(chave);
  const todas = new Set([...variantesDasPalavras(chave), ...reordenadas]);
  return [...todas].sort();
}

/** "cloreto de sodio" → "sodium chloride"; "sulfato ferroso" → "ferrous sulfate". */
function variantesComAnion(chave: string): string[] {
  const de = /^(\S+) de (.+)$/.exec(chave);
  if (de !== null && ANIONS.has(de[1] as string)) {
    const ions = variantesDaPalavra(de[1] as string);
    return variantesEmIngles(de[2] as string).flatMap((y) => ions.map((a) => `${y} ${a}`));
  }
  const adj = /^(\S+) (ferroso|ferrico)$/.exec(chave);
  if (adj !== null && ANIONS.has(adj[1] as string)) {
    return variantesDaPalavra(adj[2] as string).flatMap((j) =>
      variantesDaPalavra(adj[1] as string).map((a) => `${j} ${a}`),
    );
  }
  return [];
}

function variantesDasPalavras(chave: string): string[] {
  const palavras = chave.split(' ');
  let combinacoes: string[][] = [[]];
  for (const p of palavras) {
    const vs = variantesDaPalavra(p);
    const prox: string[][] = [];
    for (const c of combinacoes) for (const v of vs) prox.push([...c, v]);
    combinacoes = prox.length > MAX_TOTAL ? prox.slice(0, MAX_TOTAL) : prox;
  }
  const saida = new Set(combinacoes.map((c) => c.join(' ')));
  if (palavras[0] === 'acido' && palavras.length > 1) {
    for (const c of combinacoes) saida.add(`${c.slice(1).join(' ')} acid`);
  }
  return [...saida];
}

// ---------------------------------------------------------------------------------------------
// Sinônimos: nomes diferentes para a mesma substância. SÓ SUGESTÃO (ADR 0006): nunca mapeia
// sozinho, porque seria um dicionário que ninguém revisou decidindo no ponto mais crítico.

const SINONIMOS: Readonly<Record<string, readonly string[]>> = {
  paracetamol: ['acetaminophen'],
  dipirona: ['metamizole', 'dipyrone', 'metamizole sodium'],
  adrenalina: ['epinephrine'],
  noradrenalina: ['norepinephrine'],
  salbutamol: ['albuterol'],
  glibenclamida: ['glyburide'],
  petidina: ['meperidine', 'pethidine'],
  varfarina: ['warfarin'],
  fenitoina: ['phenytoin'],
  levotiroxina: ['levothyroxine'],
  colecalciferol: ['cholecalciferol', 'vitamin d3'],
  cianocobalamina: ['cyanocobalamin', 'vitamin b12'],
  tiamina: ['thiamine'],
  piridoxina: ['pyridoxine'],
  retinol: ['vitamin a', 'retinol'],
  nicotinamida: ['niacinamide', 'nicotinamide'],
  'acido acetilsalicilico': ['aspirin', 'acetylsalicylic acid'],
  'acido ascorbico': ['ascorbic acid', 'vitamin c'],
};

/** Nomes em inglês que costumam designar o mesmo que `chave` (já normalizada e sem sal). */
export const sinonimosEmIngles = (chave: string): string[] => [...(SINONIMOS[chave] ?? [])];

// ---------------------------------------------------------------------------------------------
// Similaridade (só para sugerir candidatos à revisão; nunca decide um mapeamento)

const bigramas = (s: string): Set<string> => {
  const t = `^${s}$`;
  const r = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) r.add(t.slice(i, i + 2));
  return r;
};

export interface NomeIngles {
  id: number;
  nome: string;
}
export interface Candidato {
  id: number;
  nome: string;
  /** `sinonimo`: veio da tabela de sinônimos (só sugestão), não da grafia. */
  origem?: 'sinonimo';
  /** Coeficiente de Dice sobre bigramas, de 0 a 1. */
  similaridade: number;
}

/** Índice invertido de bigramas dos nomes em inglês, para achar os mais parecidos sem varrer tudo. */
export class IndiceDeNomes {
  private readonly chaves: string[];
  private readonly tamanhos: number[];
  private readonly postagens = new Map<string, number[]>();
  private readonly porChave = new Map<string, number[]>();

  constructor(private readonly nomes: readonly NomeIngles[]) {
    this.chaves = nomes.map((n) => chaveDe(n.nome));
    this.tamanhos = [];
    this.chaves.forEach((c, i) => {
      const mesmo = this.porChave.get(c);
      if (mesmo === undefined) this.porChave.set(c, [(nomes[i] as NomeIngles).id]);
      else mesmo.push((nomes[i] as NomeIngles).id);
      const b = bigramas(c);
      this.tamanhos.push(b.size);
      for (const g of b) {
        const p = this.postagens.get(g);
        if (p === undefined) this.postagens.set(g, [i]);
        else p.push(i);
      }
    });
  }

  /** Os `n` nomes mais parecidos com qualquer uma das candidatas, do mais para o menos parecido. */
  parecidos(candidatas: readonly string[], n = 3, minimo = 0.5): Candidato[] {
    const melhor = new Map<number, number>();
    for (const c of candidatas) {
      const g = bigramas(c);
      const comuns = new Map<number, number>();
      for (const b of g) {
        for (const i of this.postagens.get(b) ?? []) comuns.set(i, (comuns.get(i) ?? 0) + 1);
      }
      for (const [i, k] of comuns) {
        const d = (2 * k) / (g.size + (this.tamanhos[i] as number));
        if (d >= minimo && d > (melhor.get(i) ?? 0)) melhor.set(i, d);
      }
    }
    return [...melhor.entries()]
      .map(([i, d]) => ({
        id: (this.nomes[i] as NomeIngles).id,
        nome: (this.nomes[i] as NomeIngles).nome,
        similaridade: Math.round(d * 1000) / 1000,
      }))
      .sort((a, b) => b.similaridade - a.similaridade || a.id - b.id)
      .slice(0, n);
  }

  /** Ids dos medicamentos cujo nome, normalizado, é igual a alguma das candidatas. */
  exatos(candidatas: readonly string[]): number[] {
    const ids = new Set<number>();
    for (const c of candidatas) for (const id of this.porChave.get(c) ?? []) ids.add(id);
    return [...ids].sort((a, b) => a - b);
  }
}
