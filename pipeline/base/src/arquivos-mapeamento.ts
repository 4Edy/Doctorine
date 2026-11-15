import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SaidaMapeamento } from '@doctorine/mapeamento';

/** CSV para planilha em português: separador `;`, UTF-8 com BOM (o Excel abre com os acentos certos). */
export function csv(
  cabecalho: readonly string[],
  linhas: ReadonlyArray<ReadonlyArray<string | number>>,
): string {
  const campo = (v: string | number): string => {
    const t = String(v);
    return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return '﻿' + [cabecalho, ...linhas].map((l) => l.map(campo).join(';')).join('\r\n') + '\r\n';
}

export const ARQUIVOS_MAPEAMENTO = {
  fila: 'mapeamento-fila.csv',
  filaJson: 'mapeamento-fila.json',
  automaticos: 'mapeamento-automaticos.csv',
  referencia: 'mapeamento-referencia.csv',
} as const;

/**
 * Escreve ao lado da base os arquivos que a farmacêutica e o Edu usam para revisar:
 * - a fila de revisão (o que ficou pendente, do mais para o menos importante);
 * - os mapeamentos automáticos (para conferir por amostragem);
 * - a situação dos nomes do conjunto de referência.
 * As decisões voltam em `data/mapeamento/decisoes.json` (ver docs/mapeamento.md).
 */
export function escreverArquivosDoMapeamento(diretorio: string, m: SaidaMapeamento): void {
  const cand = (i: number, f: SaidaMapeamento['fila'][number]): string => {
    const c = f.candidatos[i];
    return c === undefined ? '' : `${c.id} · ${c.nome} · ${c.similaridade}`;
  };
  writeFileSync(
    join(diretorio, ARQUIVOS_MAPEAMENTO.fila),
    csv(
      [
        'posicao',
        'chave',
        'texto_na_anvisa',
        'medicamentos_ativos',
        'medicamentos_total',
        'motivo',
        'candidato_1 (id · nome · similaridade)',
        'candidato_2',
        'candidato_3',
        'exemplos_de_produtos',
      ],
      m.fila.map((f) => [
        f.posicao,
        f.chave,
        f.textoExemplo,
        f.medicamentosAtivos,
        f.medicamentosTotal,
        f.motivo,
        cand(0, f),
        cand(1, f),
        cand(2, f),
        f.exemplos.join(' | '),
      ]),
    ),
    'utf8',
  );
  writeFileSync(
    join(diretorio, ARQUIVOS_MAPEAMENTO.filaJson),
    JSON.stringify(m.fila, null, 2) + '\n',
    'utf8',
  );
  writeFileSync(
    join(diretorio, ARQUIVOS_MAPEAMENTO.automaticos),
    csv(
      [
        'chave',
        'texto_na_anvisa',
        'medicamentos_ativos',
        'ddinter_ids',
        'nomes_em_ingles',
        'como_foi_decidido',
      ],
      m.automaticos.map((a) => [
        a.chave,
        a.textoExemplo,
        a.medicamentosAtivos,
        a.ddinterIds.join(' | '),
        a.nomesEn.join(' | '),
        a.motivo,
      ]),
    ),
    'utf8',
  );
  writeFileSync(
    join(diretorio, ARQUIVOS_MAPEAMENTO.referencia),
    csv(
      ['par_lado', 'nome', 'situacao', 'principio_ativo'],
      m.referencia.map((r) => [r.id, r.nome, r.situacao, r.slug ?? '']),
    ),
    'utf8',
  );
}
