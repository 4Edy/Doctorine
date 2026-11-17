import { join } from 'node:path';
import {
  alimentoSite,
  doencaSite,
  farmacoPares,
  farmacoCsv,
  lerJsonl,
  localizar,
  relatorioDdinter,
  relatorioManejo,
  relatorioPares,
  relatorioSite,
  textoManejo,
  textoSite,
} from '@doctorine/pipeline-base';
import type { EntradaTextos } from './textos.js';
import type { NomeFarmaco } from './protecao.js';

export interface Versoes {
  site?: string;
  manejo?: string;
  pares?: string;
  ddinter?: string;
}
export interface EntradaCompleta {
  textos: EntradaTextos;
  nomes: NomeFarmaco[];
  versoes: { site: string; manejo: string; pares: string; ddinter: string };
}

/** Lê as saídas processadas do DDInter (P5) em `<raiz>/data/processed`. */
export function lerEntradaCompleta(raiz: string, v: Versoes = {}): EntradaCompleta {
  const site = localizar(raiz, 'ddinter-site', relatorioSite, v.site);
  const manejo = localizar(raiz, 'ddinter-manejo', relatorioManejo, v.manejo);
  const pares = localizar(raiz, 'ddinter-pares', relatorioPares, v.pares);
  const csv = localizar(raiz, 'ddinter', relatorioDdinter, v.ddinter);
  const nomes = new Map<string, string>();
  for (const f of lerJsonl(join(csv.pasta, 'farmacos.jsonl'), farmacoCsv)) nomes.set(f.id, f.nome);
  for (const f of lerJsonl(join(pares.pasta, 'farmacos.jsonl'), farmacoPares)) {
    if (!nomes.has(f.id)) nomes.set(f.id, f.nome);
  }
  return {
    textos: {
      textos: lerJsonl(join(site.pasta, 'textos-interacao.jsonl'), textoSite),
      alimentos: lerJsonl(join(site.pasta, 'alimentos.jsonl'), alimentoSite),
      doencas: lerJsonl(join(site.pasta, 'doencas.jsonl'), doencaSite),
      manejo: lerJsonl(join(manejo.pasta, 'textos-manejo.jsonl'), textoManejo),
    },
    nomes: [...nomes].map(([id, nome]) => ({ id, nome })),
    versoes: {
      site: site.fonte.versao,
      manejo: manejo.fonte.versao,
      pares: pares.fonte.versao,
      ddinter: csv.fonte.versao,
    },
  };
}
