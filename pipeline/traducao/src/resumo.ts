import type { Memoria } from './memoria.js';
import { NOMES_PRIORIDADE, type UnidadeTexto } from './textos.js';

export interface LinhaResumo {
  nivel: string;
  total: number;
  semTraducao: number;
  naoRevisado: number;
  revisado: number;
  corrigido: number;
}
export interface Resumo {
  total: number;
  porNivel: LinhaResumo[];
  /** Critério do plano para o uso real: todo texto de interação grave revisado. */
  gravesRevisados: { revisados: number; total: number };
  /** Textos na memória cujo inglês não está mais nas unidades (a fonte mudou). */
  orfaos: number;
}

export function resumir(unidades: readonly UnidadeTexto[], memoria: Memoria): Resumo {
  const linhas: LinhaResumo[] = NOMES_PRIORIDADE.map((nivel) => ({
    nivel,
    total: 0,
    semTraducao: 0,
    naoRevisado: 0,
    revisado: 0,
    corrigido: 0,
  }));
  const ids = new Set<string>();
  for (const u of unidades) {
    ids.add(u.id);
    const l = linhas[u.prioridade] as LinhaResumo;
    l.total++;
    const e = memoria.estado(u.id);
    if (e === undefined) l.semTraducao++;
    else if (e.status === 'nao-revisado') l.naoRevisado++;
    else if (e.status === 'revisado') l.revisado++;
    else l.corrigido++;
  }
  const maj = linhas[0] as LinhaResumo;
  let orfaos = 0;
  for (const e of memoria.todos()) if (!ids.has(e.id)) orfaos++;
  return {
    total: unidades.length,
    porNivel: linhas,
    gravesRevisados: { revisados: maj.revisado + maj.corrigido, total: maj.total },
    orfaos,
  };
}

export function resumoEmMarkdown(r: Resumo): string {
  const cab = '| Gravidade | Textos | Sem tradução | Não revisado | Revisado | Corrigido |';
  const linhas = r.porNivel.map(
    (l) =>
      `| ${l.nivel} | ${l.total} | ${l.semTraducao} | ${l.naoRevisado} | ${l.revisado} | ${l.corrigido} |`,
  );
  return [
    '# Tradução: situação',
    `${r.total} textos distintos em inglês. Gravidade = a mais grave entre os usos do texto.`,
    [cab, '| --- | --- | --- | --- | --- | --- |', ...linhas].join('\n'),
    `Interações graves revisadas: ${r.gravesRevisados.revisados} de ${r.gravesRevisados.total}.`,
    r.orfaos > 0
      ? `Atenção: ${r.orfaos} tradução(ões) na memória não correspondem a nenhum texto atual (o inglês mudou na fonte).`
      : '',
  ]
    .filter((x) => x !== '')
    .join('\n\n');
}
