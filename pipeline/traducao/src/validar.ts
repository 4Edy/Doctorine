import { termosAusentes, type Glossario } from './glossario.js';
import { marcadoresDe } from './protecao.js';

export interface Problema {
  gravidade: 'erro' | 'aviso';
  tipo: 'vazio' | 'marcador' | 'glossario' | 'proporcao' | 'genero' | 'sem-traducao';
  detalhe: string;
}

/**
 * Confere uma tradução contra o texto protegido (com marcadores). Erros impedem o registro;
 * avisos entram no relatório.
 *
 * - `vazio`: tradução em branco;
 * - `marcador`: o conjunto de marcadores de fármaco mudou (nome perdido, repetido ou inventado);
 * - `glossario`: termo do glossário presente no inglês sem a tradução do glossário (erro se
 *   aprovado, aviso se proposto);
 * - `genero`: artigo ou contração diretamente antes de um marcador ("o [[F1]]", "pelo [[F1]]"): o
 *   gênero do nome em português só se conhece depois, então "o varfarina" seria erro (aviso);
 * - `proporcao`: tamanho muito diferente do original (provável corte ou texto acrescentado).
 */
export function validarTraducao(en: string, pt: string, g: Glossario): Problema[] {
  const p: Problema[] = [];
  if (pt.trim() === '') {
    return [{ gravidade: 'erro', tipo: 'vazio', detalhe: 'tradução em branco' }];
  }
  const a = marcadoresDe(en).join(',');
  const b = marcadoresDe(pt).join(',');
  if (a !== b) {
    p.push({
      gravidade: 'erro',
      tipo: 'marcador',
      detalhe: `marcadores de fármaco diferem (original: [${a}]; tradução: [${b}])`,
    });
  }
  for (const t of termosAusentes(en, pt, g)) {
    p.push({
      gravidade: t.status === 'aprovado' ? 'erro' : 'aviso',
      tipo: 'glossario',
      detalhe: `"${t.en}" deveria virar "${t.pt}"`,
    });
  }
  const ARTIGO_ANTES =
    /(?<![\p{L}])(?:o|os|as|ao|aos|à|às|do|da|dos|das|no|na|nos|nas|pelo|pela|pelos|pelas)\s+\[\[F\d+\]\]/giu;
  // "a" minúsculo costuma ser preposição ("exposição a [[F1]]"): só vale o "A" de início de frase
  const ARTIGO_A = /(?<![\p{L}])A\s+\[\[F\d+\]\]/gu;
  const artigos = [...pt.matchAll(ARTIGO_ANTES), ...pt.matchAll(ARTIGO_A)].map((m) => `"${m[0]}"`);
  if (artigos.length > 0) {
    p.push({
      gravidade: 'aviso',
      tipo: 'genero',
      detalhe: `artigo antes de marcador de fármaco: ${[...new Set(artigos)].slice(0, 3).join(', ')}`,
    });
  }
  const razao = pt.length / Math.max(en.length, 1);
  if (en.length >= 40 && (razao < 0.5 || razao > 2)) {
    p.push({
      gravidade: 'aviso',
      tipo: 'proporcao',
      detalhe: `tradução com ${(razao * 100).toFixed(0)}% do tamanho do original`,
    });
  }
  return p;
}

export const temErro = (p: readonly Problema[]): boolean => p.some((x) => x.gravidade === 'erro');
