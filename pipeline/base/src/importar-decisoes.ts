import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  DECISOES_VAZIAS,
  chaveDe,
  validarDecisoes,
  type ArquivoDecisoes,
  type Decisao,
} from '@doctorine/mapeamento';
import { CAMINHO_DECISOES } from './entrada.js';

const AJUDA = `Uso: pnpm pipeline:decisoes <fila.csv> --revisor "Nome" [opções]

Lê a fila de revisão (mapeamento-fila.csv) preenchida pela farmacêutica e acrescenta as decisões a
data/mapeamento/decisoes.json. Linhas com a coluna "acao" vazia são ignoradas. Se houver qualquer
erro, nada é gravado.

Colunas que ela preenche (as outras vêm prontas):
  acao          equivale | sem-equivalente | mesmo-que
  ddinter_ids   (equivale) o número do medicamento do DDInter; mais de um separado por | ;
                "c1", "c2" ou "c3" = o candidato 1, 2 ou 3 da própria linha
  como_chave    (mesmo-que) a chave do componente que já foi resolvido
  nome_pt       (opcional) nome oficial em português do princípio ativo
  observacao    (opcional) motivo, fica registrado

Opções:
  --revisor <nome>   quem decidiu (obrigatório; fica em cada decisão)
  --data <AAAA-MM-DD>  data da revisão (padrão: hoje)
  --decisoes <arquivo> arquivo de decisões (padrão: data/mapeamento/decisoes.json)
  --raiz <pasta>     raiz do repositório (padrão: pasta atual)
  --simular          só confere e mostra o resumo, sem gravar

Salve a planilha como "CSV UTF-8" (com separador ; ou ,).
`;

/** Lê CSV com aspas, BOM, CRLF e separador `;` ou `,` (detectado na primeira linha). */
export function lerCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, '');
  const primeira = t.split(/\r?\n/, 1)[0] ?? '';
  const sep = primeira.split(';').length >= primeira.split(',').length ? ';' : ',';
  const linhas: string[][] = [];
  let campo = '';
  let linha: string[] = [];
  let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i] as string;
    if (aspas) {
      if (c === '"' && t[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) {
      linha.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      linha.push(campo);
      campo = '';
      if (linha.some((x) => x.trim() !== '')) linhas.push(linha);
      linha = [];
    } else campo += c;
  }
  linha.push(campo);
  if (linha.some((x) => x.trim() !== '')) linhas.push(linha);
  return linhas;
}

export interface OpcoesDoCsv {
  revisadoPor: string;
  revisadoEm: string;
  /** Chaves que já têm decisão (não podem ser decididas de novo por aqui). */
  existentes: ReadonlySet<string>;
}
export interface DecisoesDoCsv {
  novas: Decisao[];
  semAcao: number;
  erros: string[];
}

const ACOES = new Set(['equivale', 'sem-equivalente', 'mesmo-que']);

/** Converte as linhas preenchidas da fila em decisões. Não grava nada. */
export function decisoesDoCsv(texto: string, o: OpcoesDoCsv): DecisoesDoCsv {
  const linhas = lerCsv(texto);
  const cab = (linhas[0] ?? []).map((c) =>
    chaveDe(c)
      .replace(/\s*\(.*$/, '')
      .replace(/[ -]/g, '_'),
  );
  const col = (nome: string): number => cab.indexOf(nome);
  const iChave = col('chave');
  const iAcao = col('acao');
  const iIds = col('ddinter_ids');
  const iComo = col('como_chave');
  const iNome = col('nome_pt');
  const iObs = col('observacao');
  const iCand = ['candidato_1', 'candidato_2', 'candidato_3'].map(col);
  const erros: string[] = [];
  if (iChave < 0 || iAcao < 0) {
    return { novas: [], semAcao: 0, erros: ['o CSV não tem as colunas "chave" e "acao"'] };
  }
  const novas: Decisao[] = [];
  const vistas = new Set<string>();
  let semAcao = 0;
  linhas.slice(1).forEach((l, k) => {
    const n = k + 2; // número da linha na planilha
    const campo = (i: number): string => (i < 0 ? '' : (l[i] ?? '').trim());
    const acaoBruta = campo(iAcao);
    if (acaoBruta === '') {
      semAcao++;
      return;
    }
    const chave = campo(iChave);
    const erro = (m: string): void => void erros.push(`linha ${n} (${chave}): ${m}`);
    const acao = acaoBruta.toLowerCase().replace(/[\s_]+/g, '-');
    if (!ACOES.has(acao))
      return erro(`ação "${acaoBruta}" desconhecida (use equivale, sem-equivalente ou mesmo-que)`);
    if (chave !== chaveDe(chave) || chave === '')
      return erro('chave fora do formato (use a coluna "chave" da fila, sem mexer)');
    if (o.existentes.has(chave)) return erro('já existe decisão para esta chave em decisoes.json');
    if (vistas.has(chave)) return erro('chave repetida no CSV');
    vistas.add(chave);
    const base = {
      chave,
      revisadoPor: o.revisadoPor,
      revisadoEm: o.revisadoEm,
      ...(campo(iObs) !== '' ? { motivo: campo(iObs) } : {}),
    };
    const nomePt = campo(iNome);
    if (acao === 'equivale') {
      const ids: number[] = [];
      for (const t of campo(iIds)
        .split(/[|,;\s]+/)
        .filter((x) => x !== '')) {
        const c = /^c([1-3])$/i.exec(t);
        if (c !== null) {
          const cel = campo(iCand[Number(c[1]) - 1] ?? -1);
          const id = /^(\d+)\b/.exec(cel);
          if (id === null) return erro(`"${t}": a linha não tem candidato ${c[1]}`);
          ids.push(Number(id[1]));
        } else if (/^\d+$/.test(t) && Number(t) > 0) ids.push(Number(t));
        else
          return erro(
            `"${t}" não é um número de medicamento do DDInter (use só o número, ex.: 1162, ou c1)`,
          );
      }
      if (ids.length === 0) return erro('"equivale" precisa de ddinter_ids');
      novas.push({
        ...base,
        acao: 'equivale',
        ddinterIds: [...new Set(ids)].sort((a, b) => a - b),
        ...(nomePt !== '' ? { nomePt } : {}),
      });
    } else if (acao === 'sem-equivalente') {
      novas.push({ ...base, acao: 'sem-equivalente', ...(nomePt !== '' ? { nomePt } : {}) });
    } else {
      const como = chaveDe(campo(iComo));
      if (como === '') return erro('"mesmo-que" precisa de como_chave');
      novas.push({ ...base, acao: 'mesmo-que', comoChave: como });
    }
  });
  return { novas, semAcao, erros };
}

/** Junta as decisões novas às existentes (ordenadas por chave) e valida o arquivo todo. */
export function juntarDecisoes(
  atual: ArquivoDecisoes,
  novas: readonly Decisao[],
  data: string,
): ArquivoDecisoes {
  const juntas = [...atual.decisoes, ...novas].sort((a, b) => a.chave.localeCompare(b.chave));
  const r = validarDecisoes({ versao: 1, atualizadoEm: data, decisoes: juntas });
  if (!r.ok)
    throw new Error(`as decisões resultantes são inválidas: ${r.problemas.slice(0, 5).join('; ')}`);
  return r.dados;
}

const hoje = (): string => {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function executar(argv: readonly string[]): number {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      revisor: { type: 'string' },
      data: { type: 'string' },
      decisoes: { type: 'string' },
      raiz: { type: 'string' },
      simular: { type: 'boolean' },
      ajuda: { type: 'boolean' },
    },
  });
  const [csvCaminho] = positionals;
  if (values.ajuda === true || csvCaminho === undefined) {
    console.log(AJUDA);
    return values.ajuda === true ? 0 : 1;
  }
  if (values.revisor === undefined || values.revisor.trim().length < 2) {
    console.error('Erro: diga quem revisou, com --revisor "Nome".');
    return 1;
  }
  if (!existsSync(csvCaminho)) {
    console.error(`Erro: ${csvCaminho} não existe.`);
    return 1;
  }
  const arquivo = resolve(values.decisoes ?? join(values.raiz ?? process.cwd(), CAMINHO_DECISOES));
  let atual = DECISOES_VAZIAS;
  if (existsSync(arquivo)) {
    const r = validarDecisoes(JSON.parse(readFileSync(arquivo, 'utf8')));
    if (!r.ok) {
      console.error(`Erro: ${arquivo} está fora do formato: ${r.problemas.slice(0, 5).join('; ')}`);
      return 1;
    }
    atual = r.dados;
  }
  const data = values.data ?? hoje();
  const lido = decisoesDoCsv(readFileSync(csvCaminho, 'utf8'), {
    revisadoPor: values.revisor.trim(),
    revisadoEm: data,
    existentes: new Set(atual.decisoes.map((d) => d.chave)),
  });
  if (lido.erros.length > 0) {
    console.error(`${lido.erros.length} problema(s); nada foi gravado:`);
    for (const e of lido.erros.slice(0, 30)) console.error(`  - ${e}`);
    if (lido.erros.length > 30) console.error(`  ... e mais ${lido.erros.length - 30}`);
    return 1;
  }
  let juntas: ArquivoDecisoes;
  try {
    juntas = juntarDecisoes(atual, lido.novas, data);
  } catch (erro) {
    console.error(`Erro: ${(erro as Error).message}`);
    return 1;
  }
  const porAcao = lido.novas.reduce<Record<string, number>>(
    (d, x) => ((d[x.acao] = (d[x.acao] ?? 0) + 1), d),
    {},
  );
  console.log(
    `${lido.novas.length} decisão(ões) ${values.simular === true ? 'conferida(s)' : 'importada(s)'} ` +
      `(${
        Object.entries(porAcao)
          .map(([a, n]) => `${n} ${a}`)
          .join(', ') || 'nenhuma'
      }); ` +
      `${lido.semAcao} linha(s) sem ação ignorada(s); total no arquivo: ${juntas.decisoes.length}.`,
  );
  if (values.simular !== true && lido.novas.length > 0) {
    writeFileSync(arquivo, `${JSON.stringify(juntas, null, 2)}\n`, 'utf8');
    console.log(`Gravado em ${arquivo}. Rode pnpm pipeline:base para ver a nova cobertura.`);
  }
  return 0;
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('importar-decisoes.ts')
) {
  process.exitCode = executar(process.argv.slice(2));
}
