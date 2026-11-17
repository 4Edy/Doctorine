import { termosAusentes, type Glossario } from './glossario.js';
import { marcadoresDe } from './protecao.js';

export interface Problema {
  gravidade: 'erro' | 'aviso';
  tipo: 'vazio' | 'marcador' | 'glossario' | 'proporcao' | 'sem-traducao';
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
