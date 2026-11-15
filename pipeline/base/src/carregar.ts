import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { dirname, join } from 'node:path';
import {
  GRAVIDADES,
  gravidadeDoNivel,
  gravidadeDosNiveis,
  lerMigracoes,
  migrar,
  reconstruirBusca,
  type Gravidade,
  type NivelOriginal,
} from '@doctorine/database';
import {
  ErroMapeamento,
  VERSAO_REGRAS,
  mapear,
  type Cobertura,
  type SaidaMapeamento,
} from '@doctorine/mapeamento';
import {
  ErroCarga,
  fonteDasDecisoes,
  type Entradas,
  type FonteRelatorio,
  type RegistroAnvisaEntrada,
} from './entrada.js';

const MAX_AMOSTRA = 5;

export interface Contagem {
  /** Itens lidos da fonte. */
  entrada: number;
  /** Linhas gravadas por causa deles. */
  gravadas: number;
  /** Itens que não viraram linha, com o motivo em `descartes`. */
  descartados: number;
}

export interface RelatorioCarga {
  base: { versao: string; geradaAPartirDe: string; esquema: string };
  arquivo: { nome: string; bytes: number; sha256: string };
  fontes: Array<{ fonte: string; versao: string; sha256: string; baixadoEm: string }>;
  contas: Record<string, Contagem>;
  tabelas: Record<string, number>;
  descartes: { total: number; porMotivo: Record<string, number>; amostra: string[] };
  avisos: { total: number; porTipo: Record<string, number>; amostra: string[] };
  medicamento: {
    registrosLidos: number;
    medicamentos: number;
    comMaisDeUmaLinha: number;
    ativos: number;
    semNumeroDeRegistro: number;
    semPrincipioAtivo: number;
    /** Por campo: quantos medicamentos têm valores diferentes entre as linhas juntadas. */
    camposDiferentesEntreLinhas: Record<string, number>;
  };
  farmacos: { total: number; comDrugbank: number; semDrugbank: number };
  interacoes: {
    total: number;
    emSiteECsv: number;
    soSite: number;
    soCsv: number;
    porGravidade: Record<Gravidade, number>;
    /** Pares de medicamentos com mais de uma linha (mais de um id de par no site). */
    paresComMaisDeUmaLinha: number;
  };
  mapeamento: {
    versaoRegras: number;
    decisoes: number;
    principios: number;
    /** Princípios que só em português (de uma decisão) foram unidos a um do DDInter de mesmo nome. */
    principiosMesclados: number;
    cobertura: Cobertura;
    filaDeRevisao: number;
    regrasDeSalUsadas: Record<string, number>;
    referencia: {
      total: number;
      porSituacao: Record<string, number>;
      semConfirmacao: Array<{ nome: string; situacao: string }>;
    };
  };
  verificacoes: {
    integrityCheck: string;
    foreignKeyCheck: number;
    /** Grupos de princípios ativos com o mesmo nome em português (duplicidade). Deve ser 0. */
    principiosComNomeRepetido: number;
  };
}

export interface ResultadoCarga {
  relatorio: RelatorioCarga;
  arquivo: string;
  /** Saída completa do mapeamento (fila de revisão, automáticos, referência) para os arquivos. */
  mapeamento: SaidaMapeamento;
}

const numero = (id: string): number => Number(id.slice('DDInter'.length));
const normalizar = (s: string | null): string => (s ?? '').replace(/\s+/g, ' ').trim();
const json = (v: unknown): string => JSON.stringify(v);
const referencias = (s: string | null): string[] =>
  s === null
    ? []
    : s
        .split('|')
        .map((r) => r.trim())
        .filter((r) => r !== '');
const conta = (d: Record<string, number>, k: string): void => {
  d[k] = (d[k] ?? 0) + 1;
};
const ordenado = <T>(d: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(d).sort(([a], [b]) => a.localeCompare(b, 'en')));

/** Versão da base: depende só das versões das fontes, na ordem fixa em que são carregadas. */
export function versaoDaBase(fontes: ReadonlyArray<{ fonte: string; versao: string }>): string {
  return createHash('sha256')
    .update(fontes.map((f) => `${f.fonte}:${f.versao}`).join('\n'))
    .digest('hex')
    .slice(0, 12);
}

function fontesDe(e: Entradas): Array<{ chave: string; fonte: FonteRelatorio }> {
  return [
    { chave: 'anvisa', fonte: e.anvisa.fonte },
    { chave: 'csv', fonte: e.csv.fonte },
    { chave: 'site', fonte: e.site.fonte },
    { chave: 'pares', fonte: e.pares.fonte },
    { chave: 'manejo', fonte: e.manejo.fonte },
    { chave: 'decisoes', fonte: fonteDasDecisoes(e.mapeamento.decisoes) },
  ];
}

/**
 * A versão da base depende das versões das fontes, das decisões humanas do mapeamento e das regras
 * do mapeamento automático (`VERSAO_REGRAS`): mudar qualquer uma delas muda a base.
 */
export function versaoDasEntradas(e: Entradas): string {
  return versaoDaBase([
    ...fontesDe(e).map((f) => ({ fonte: f.fonte.id, versao: f.fonte.versao })),
    { fonte: 'regras-mapeamento', versao: String(VERSAO_REGRAS) },
  ]);
}

type Inserir = (...valores: SQLInputValue[]) => number;
function preparar(db: DatabaseSync, tabela: string, colunas: readonly string[]): Inserir {
  const st = db.prepare(
    `INSERT INTO ${tabela} (${colunas.join(', ')}) VALUES (${colunas.map(() => '?').join(', ')})`,
  );
  return (...valores) => Number(st.run(...valores).lastInsertRowid);
}

/**
 * Gera o arquivo SQLite a partir das saídas processadas das duas fontes. Só depende das entradas
 * (nada de relógio nem de ordem de leitura do disco): as mesmas entradas dão o mesmo arquivo, byte a
 * byte. O arquivo só aparece no caminho final se a carga e as verificações terminarem.
 */
export function carregarBase(entradas: Entradas, caminho: string): ResultadoCarga {
  mkdirSync(dirname(caminho), { recursive: true });
  const temporario = `${caminho}.tmp`;
  rmSync(temporario, { force: true });
  const db = new DatabaseSync(temporario);
  try {
    const migracoes = lerMigracoes();
    db.exec('PRAGMA journal_mode = DELETE');
    migrar(db, migracoes);

    const contas: Record<string, Contagem> = {};
    const descartesPorMotivo: Record<string, number> = {};
    const amostraDescartes: string[] = [];
    const avisosPorTipo: Record<string, number> = {};
    const amostraAvisos: string[] = [];
    const descartar = (conjunto: string, motivo: string, detalhe: string): void => {
      const c = contas[conjunto] as Contagem;
      c.descartados++;
      conta(descartesPorMotivo, `${conjunto}: ${motivo}`);
      if ((descartesPorMotivo[`${conjunto}: ${motivo}`] as number) <= MAX_AMOSTRA) {
        amostraDescartes.push(`${conjunto}: ${motivo} (${detalhe})`);
      }
    };
    const avisar = (tipo: string, detalhe: string): void => {
      conta(avisosPorTipo, tipo);
      if ((avisosPorTipo[tipo] as number) <= MAX_AMOSTRA) amostraAvisos.push(`${tipo}: ${detalhe}`);
    };
    const abrir = (conjunto: string, entrada: number): Contagem =>
      (contas[conjunto] = { entrada, gravadas: 0, descartados: 0 });

    db.exec('BEGIN');

    // ---- proveniência ----
    const fontes = fontesDe(entradas);
    const inserirFonte = preparar(db, 'fonte_versao', [
      'fonte',
      'versao',
      'sha256',
      'baixado_em',
      'origem',
      'url',
    ]);
    const fv: Record<string, number> = {};
    for (const { chave, fonte } of fontes) {
      fv[chave] = inserirFonte(
        fonte.id,
        fonte.versao,
        fonte.sha256,
        fonte.baixadoEm,
        fonte.origem,
        fonte.url,
      );
    }
    const fvId = (chave: string): number => fv[chave] as number;

    // ---- ANVISA: um medicamento por número de registro ----
    const regs = entradas.anvisa.registros;
    const grupos = new Map<string, RegistroAnvisaEntrada[]>();
    for (const r of regs) {
      const chave = r.numeroRegistro ?? `sem-numero:${r.proveniencia.linha}`;
      const g = grupos.get(chave);
      if (g === undefined) grupos.set(chave, [r]);
      else g.push(r);
    }
    const ehAtivo = (r: RegistroAnvisaEntrada): boolean =>
      r.situacaoRegistro.trim().toLowerCase() === 'ativo';
    const camposComparados: Array<[string, (r: RegistroAnvisaEntrada) => string]> = [
      ['nomeProduto', (r) => r.nomeProduto],
      ['tipoProduto', (r) => r.tipoProduto],
      ['categoriaRegulatoria', (r) => r.categoriaRegulatoria ?? ''],
      ['classeTerapeutica', (r) => r.classeTerapeutica ?? ''],
      ['empresa', (r) => `${r.empresa?.cnpj ?? ''}|${r.empresa?.nome ?? ''}`],
      ['numeroProcesso', (r) => r.numeroProcesso ?? ''],
      ['dataFinalizacaoProcesso', (r) => r.dataFinalizacaoProcesso ?? ''],
      ['vencimentoRegistro', (r) => r.vencimentoRegistro ?? ''],
      ['principioAtivo', (r) => r.principioAtivo ?? ''],
    ];
    const diferentes: Record<string, number> = {};
    const medicamentos = [...grupos.values()]
      .map((g) => {
        const porLinha = [...g].sort((a, b) => a.proveniencia.linha - b.proveniencia.linha);
        const representante = porLinha.find(ehAtivo) ?? (porLinha[0] as RegistroAnvisaEntrada);
        for (const [campo, f] of camposComparados) {
          if (new Set(porLinha.map(f)).size > 1) conta(diferentes, campo);
        }
        return { representante, linhas: porLinha.length, ativo: porLinha.some(ehAtivo) };
      })
      .sort((a, b) => a.representante.proveniencia.linha - b.representante.proveniencia.linha);
    abrir('anvisa.registros', regs.length);
    const inserirMed = preparar(db, 'medicamento', [
      'numero_registro',
      'nome_produto',
      'tipo_produto',
      'categoria_regulatoria',
      'classe_terapeutica',
      'empresa_cnpj',
      'empresa_nome',
      'numero_processo',
      'data_finalizacao_processo',
      'vencimento_registro',
      'situacao_registro',
      'ativo',
      'principio_ativo_original',
      'linhas_origem',
      'fonte_versao_id',
      'linha',
    ]);
    let semPrincipio = 0;
    let comMaisDeUma = 0;
    const paraMapear: Array<{
      id: number;
      nome: string;
      ativo: boolean;
      principioAtivoOriginal: string | null;
    }> = [];
    for (const m of medicamentos) {
      const r = m.representante;
      if (r.principioAtivo === null) semPrincipio++;
      if (m.linhas > 1) comMaisDeUma++;
      const idMedicamento = inserirMed(
        r.numeroRegistro,
        r.nomeProduto,
        r.tipoProduto,
        r.categoriaRegulatoria,
        r.classeTerapeutica,
        r.empresa?.cnpj ?? null,
        r.empresa?.nome ?? null,
        r.numeroProcesso,
        r.dataFinalizacaoProcesso,
        r.vencimentoRegistro,
        r.situacaoRegistro,
        m.ativo ? 1 : 0,
        r.principioAtivo,
        m.linhas,
        fvId('anvisa'),
        r.proveniencia.linha,
      );
      paraMapear.push({
        id: idMedicamento,
        nome: r.nomeProduto,
        ativo: m.ativo,
        principioAtivoOriginal: r.principioAtivo,
      });
      (contas['anvisa.registros'] as Contagem).gravadas += m.linhas;
    }

    // ---- DDInter: medicamentos (união dos nomes de todas as fontes) ----
    interface NomeFarmaco {
      nome: string;
      drugbank: string | null;
      prioridade: number;
      fonte: number;
    }
    const farmacos = new Map<number, NomeFarmaco>();
    const jaAvisados = new Set<string>();
    const verFarmaco = (
      id: string,
      nome: string,
      drugbank: string | null,
      prioridade: number,
      fonte: number,
    ) => {
      const n = numero(id);
      const atual = farmacos.get(n);
      if (atual === undefined) {
        farmacos.set(n, { nome, drugbank, prioridade, fonte });
        return;
      }
      // Um aviso por medicamento e par de valores, não por linha que o cita (um medicamento
      // aparece em milhares de pares). Diferença só de maiúsculas é registrada à parte.
      if (atual.nome !== nome && !jaAvisados.has(`${n}|${atual.nome}|${nome}`)) {
        jaAvisados.add(`${n}|${atual.nome}|${nome}`);
        const soCaixa = atual.nome.toLowerCase() === nome.toLowerCase();
        avisar(
          soCaixa ? 'nome-so-difere-em-maiusculas' : 'nome-diferente-entre-fontes',
          `${id}: "${atual.nome}" e "${nome}"`,
        );
      }
      if (
        atual.drugbank !== null &&
        drugbank !== null &&
        atual.drugbank !== drugbank &&
        !jaAvisados.has(`${n}|${atual.drugbank}|${drugbank}`)
      ) {
        jaAvisados.add(`${n}|${atual.drugbank}|${drugbank}`);
        avisar('drugbank-diferente-entre-fontes', `${id}: ${atual.drugbank} e ${drugbank}`);
      }
      const drugbankFinal = atual.drugbank ?? drugbank;
      if (prioridade < atual.prioridade)
        farmacos.set(n, { nome, drugbank: drugbankFinal, prioridade, fonte });
      else atual.drugbank = drugbankFinal;
    };
    for (const f of entradas.pares.farmacos) verFarmaco(f.id, f.nome, f.drugbank, 1, fvId('pares'));
    // Os próprios pares também citam seus medicamentos: a carga não depende de `farmacos.jsonl`
    // estar completo para a chave estrangeira valer.
    for (const p of entradas.pares.pares) {
      verFarmaco(p.a.id, p.a.nome, p.a.drugbank, 1, fvId('pares'));
      verFarmaco(p.b.id, p.b.nome, p.b.drugbank, 1, fvId('pares'));
    }
    for (const f of entradas.csv.farmacos) verFarmaco(f.id, f.nome, null, 2, fvId('csv'));
    for (const i of entradas.csv.interacoes) {
      verFarmaco(i.idA, i.nomeA, null, 2, fvId('csv'));
      verFarmaco(i.idB, i.nomeB, null, 2, fvId('csv'));
    }
    for (const t of entradas.site.alimentos)
      verFarmaco(t.idFarmaco, t.farmaco, null, 3, fvId('site'));
    for (const t of entradas.site.doencas)
      verFarmaco(t.idFarmaco, t.farmaco, null, 3, fvId('site'));
    for (const t of entradas.site.duplicidade)
      verFarmaco(t.idFarmaco, t.farmaco, null, 3, fvId('site'));
    for (const a of entradas.manejo.alternativas) {
      verFarmaco(a.idFarmaco, a.nome, null, 4, fvId('manejo'));
      for (const g of a.grupos)
        for (const f of g.farmacos) verFarmaco(f.id, f.nome, null, 4, fvId('manejo'));
      for (const f of a.completo) verFarmaco(f.id, f.nome, null, 4, fvId('manejo'));
    }
    const inserirFarmaco = preparar(db, 'ddinter_farmaco', [
      'id',
      'nome_en',
      'drugbank',
      'fonte_versao_id',
    ]);
    let comDrugbank = 0;
    for (const [id, f] of [...farmacos.entries()].sort(([a], [b]) => a - b)) {
      if (f.drugbank !== null) comDrugbank++;
      inserirFarmaco(id, f.nome, f.drugbank, f.fonte);
    }
    // Todo medicamento citado por uma interação precisa existir; ids nunca vistos seriam erro de dados.
    const existe = (id: string): boolean => farmacos.has(numero(id));

    // ---- DDInter: textos (descrição, mecanismo, manejo e referências) ----
    const manejoPorTexto = new Map(entradas.manejo.textos.map((t) => [t.idTexto, t]));
    abrir('site.textos', entradas.site.textos.length);
    abrir('manejo.textos', entradas.manejo.textos.length);
    const inserirTexto = preparar(db, 'ddinter_texto', [
      'id',
      'nivel_original',
      'descricao_en',
      'manejo_en',
      'mecanismos_json',
      'referencias_json',
      'id_par_manejo',
      'fonte_texto_versao_id',
      'arquivo_texto',
      'linha_texto',
      'fonte_manejo_versao_id',
    ]);
    const textoIds = new Set<number>();
    const comManejo = new Set<number>();
    for (const t of [...entradas.site.textos].sort((a, b) => a.id - b.id)) {
      if (textoIds.has(t.id)) {
        descartar('site.textos', 'id repetido', `texto ${t.id}`);
        continue;
      }
      textoIds.add(t.id);
      const m = manejoPorTexto.get(t.id);
      if (m !== undefined) {
        comManejo.add(t.id);
        if (
          t.texto !== null &&
          m.interacao !== null &&
          normalizar(t.texto) !== normalizar(m.interacao)
        ) {
          avisar('descricao-diferente-da-pagina', `texto ${t.id}: mantida a da exportação`);
        }
      }
      inserirTexto(
        t.id,
        t.nivel,
        t.texto ?? m?.interacao ?? null,
        m?.manejo ?? null,
        json(t.mecanismos),
        json(m?.referencias ?? []),
        m?.idParLido ?? null,
        fvId('site'),
        t.proveniencia.arquivo,
        t.proveniencia.linha,
        m === undefined ? null : fvId('manejo'),
      );
      (contas['site.textos'] as Contagem).gravadas++;
    }
    for (const m of [...entradas.manejo.textos].sort((a, b) => a.idTexto - b.idTexto)) {
      if (comManejo.has(m.idTexto)) (contas['manejo.textos'] as Contagem).gravadas++;
      else descartar('manejo.textos', 'texto inexistente nas exportações', `texto ${m.idTexto}`);
    }

    // ---- DDInter: interações entre medicamentos (união dos pares do site e dos CSVs) ----
    const chavePar = (a: number, b: number): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const csvPorChave = new Map<string, (typeof entradas.csv.interacoes)[number]>();
    abrir('csv.interacoes', entradas.csv.interacoes.length);
    for (const i of entradas.csv.interacoes) {
      const chave = chavePar(numero(i.idA), numero(i.idB));
      if (csvPorChave.has(chave))
        descartar('csv.interacoes', 'par repetido nos CSVs', `${i.idA} e ${i.idB}`);
      else csvPorChave.set(chave, i);
    }
    const csvUsados = new Set<string>();
    abrir('pares.site', entradas.pares.pares.length);
    const inserirInteracao = preparar(db, 'ddinter_interacao', [
      'farmaco_a_id',
      'farmaco_b_id',
      'id_par_site',
      'id_texto',
      'nivel_site',
      'nivel_csv',
      'csv_arquivos',
      'gravidade',
      'mecanismos_json',
      'fonte_par_versao_id',
      'fonte_csv_versao_id',
    ]);
    const gravidades = Object.fromEntries(GRAVIDADES.map((g) => [g, 0])) as Record<
      Gravidade,
      number
    >;
    const letras = (i: { proveniencia: { origens: Array<{ arquivo: string }> } }): string =>
      [
        ...new Set(
          i.proveniencia.origens.map((o) => /_([A-Z])\.csv$/.exec(o.arquivo)?.[1] ?? o.arquivo),
        ),
      ]
        .sort()
        .join(',');
    const linhasPorPar = new Map<string, number>();
    let emSiteECsv = 0;
    let soSite = 0;
    const idsVistos = new Set<string>();
    const gravarInteracao = (
      a: number,
      b: number,
      site: { idPar: number; idTexto: number; nivel: NivelOriginal; mecanismos: string[] } | null,
      csv: (typeof entradas.csv.interacoes)[number] | null,
    ): void => {
      const niveis = [site?.nivel, csv?.nivel].filter(
        (n): n is NivelOriginal => n !== undefined,
      ) as [NivelOriginal, ...NivelOriginal[]];
      const gravidade = gravidadeDosNiveis(niveis);
      gravidades[gravidade]++;
      linhasPorPar.set(chavePar(a, b), (linhasPorPar.get(chavePar(a, b)) ?? 0) + 1);
      inserirInteracao(
        a,
        b,
        site?.idPar ?? null,
        site?.idTexto ?? null,
        site?.nivel ?? null,
        csv?.nivel ?? null,
        csv === null ? null : letras(csv),
        gravidade,
        json(site?.mecanismos ?? []),
        site === null ? null : fvId('pares'),
        csv === null ? null : fvId('csv'),
      );
    };
    const paresSite = [...entradas.pares.pares].sort(
      (x, y) => x.idPar - y.idPar || x.idTexto - y.idTexto,
    );
    for (const p of paresSite) {
      const a = numero(p.a.id);
      const b = numero(p.b.id);
      const rotulo = `par ${p.idPar}, texto ${p.idTexto}`;
      if (a === b) {
        descartar('pares.site', 'medicamento interage consigo mesmo', rotulo);
        continue;
      }
      if (!textoIds.has(p.idTexto)) {
        descartar('pares.site', 'texto inexistente nas exportações', rotulo);
        continue;
      }
      const dup = `${p.idPar}|${p.idTexto}`;
      if (idsVistos.has(dup)) {
        descartar('pares.site', 'mesmo par e texto repetido', rotulo);
        continue;
      }
      idsVistos.add(dup);
      const chave = chavePar(a, b);
      const csv = csvPorChave.get(chave) ?? null;
      if (csv !== null) {
        csvUsados.add(chave);
        emSiteECsv++;
      } else soSite++;
      gravarInteracao(Math.min(a, b), Math.max(a, b), p, csv);
      (contas['pares.site'] as Contagem).gravadas++;
    }
    let soCsv = 0;
    let csvGravados = 0;
    for (const [chave, i] of [...csvPorChave.entries()].sort(([x], [y]) => {
      const [xa, xb] = x.split('|').map(Number) as [number, number];
      const [ya, yb] = y.split('|').map(Number) as [number, number];
      return xa - ya || xb - yb;
    })) {
      if (csvUsados.has(chave)) {
        csvGravados++;
        continue;
      }
      const a = numero(i.idA);
      const b = numero(i.idB);
      if (a === b) {
        descartar('csv.interacoes', 'medicamento interage consigo mesmo', `${i.idA}`);
        continue;
      }
      gravarInteracao(Math.min(a, b), Math.max(a, b), null, i);
      soCsv++;
      csvGravados++;
    }
    // Um par do CSV conta uma vez, mesmo com várias linhas do site (todas levam o mesmo nível do CSV).
    (contas['csv.interacoes'] as Contagem).gravadas = csvGravados;

    // ---- DDInter: alternativas por par ----
    abrir('manejo.alternativas', entradas.manejo.alternativas.length);
    const inserirAlt = preparar(db, 'ddinter_alternativa', [
      'id_par_site',
      'id_texto',
      'farmaco_id',
      'parceiro_id',
      'grupos_json',
      'completo_json',
      'fonte_versao_id',
    ]);
    const alternativas = [...entradas.manejo.alternativas].sort(
      (a, b) => a.idPar - b.idPar || numero(a.idFarmaco) - numero(b.idFarmaco),
    );
    for (const a of alternativas) {
      if (!textoIds.has(a.idTexto)) {
        descartar('manejo.alternativas', 'texto inexistente nas exportações', `par ${a.idPar}`);
        continue;
      }
      inserirAlt(
        a.idPar,
        a.idTexto,
        numero(a.idFarmaco),
        a.idParceiro === null ? null : numero(a.idParceiro),
        json(a.grupos.map((g) => ({ atc: g.atc, farmacos: g.farmacos.map((f) => numero(f.id)) }))),
        json(a.completo.map((f) => numero(f.id))),
        fvId('manejo'),
      );
      (contas['manejo.alternativas'] as Contagem).gravadas++;
    }

    // ---- DDInter: alimento, doença e duplicidade ----
    abrir('site.alimentos', entradas.site.alimentos.length);
    const inserirAlimento = preparar(db, 'ddinter_alimento', [
      'id',
      'farmaco_id',
      'alimento_en',
      'nivel_original',
      'gravidade',
      'mecanismo_en',
      'interacao_en',
      'manejo_en',
      'referencias_json',
      'fonte_versao_id',
      'arquivo',
      'linha',
    ]);
    const alimentosVistos = new Set<number>();
    for (const r of [...entradas.site.alimentos].sort((a, b) => a.id - b.id)) {
      if (alimentosVistos.has(r.id) || !existe(r.idFarmaco)) {
        descartar(
          'site.alimentos',
          alimentosVistos.has(r.id) ? 'id repetido' : 'medicamento desconhecido',
          `id ${r.id}`,
        );
        continue;
      }
      alimentosVistos.add(r.id);
      inserirAlimento(
        r.id,
        numero(r.idFarmaco),
        r.alimento,
        r.nivel,
        gravidadeDoNivel(r.nivel),
        r.mecanismo,
        r.interacao,
        r.manejo,
        json(referencias(r.referencias)),
        fvId('site'),
        r.proveniencia.arquivo,
        r.proveniencia.linha,
      );
      (contas['site.alimentos'] as Contagem).gravadas++;
    }
    abrir('site.doencas', entradas.site.doencas.length);
    const inserirDoenca = preparar(db, 'ddinter_doenca', [
      'id',
      'farmaco_id',
      'doenca_en',
      'nivel_original',
      'gravidade',
      'texto_en',
      'referencias_json',
      'fonte_versao_id',
      'arquivo',
      'linha',
    ]);
    const doencasVistas = new Set<number>();
    for (const r of [...entradas.site.doencas].sort((a, b) => a.id - b.id)) {
      if (doencasVistas.has(r.id) || !existe(r.idFarmaco)) {
        descartar(
          'site.doencas',
          doencasVistas.has(r.id) ? 'id repetido' : 'medicamento desconhecido',
          `id ${r.id}`,
        );
        continue;
      }
      doencasVistas.add(r.id);
      inserirDoenca(
        r.id,
        numero(r.idFarmaco),
        r.doenca,
        r.nivel,
        gravidadeDoNivel(r.nivel),
        r.texto,
        json(referencias(r.referencias)),
        fvId('site'),
        r.proveniencia.arquivo,
        r.proveniencia.linha,
      );
      (contas['site.doencas'] as Contagem).gravadas++;
    }
    abrir('site.duplicidade', entradas.site.duplicidade.length);
    const inserirDup = preparar(db, 'ddinter_duplicidade', [
      'produto',
      'composicao',
      'classe',
      'farmaco_id',
      'aviso',
      'nota',
      'fonte_versao_id',
      'arquivo',
      'linha',
    ]);
    for (const r of [...entradas.site.duplicidade].sort(
      (a, b) => a.proveniencia.linha - b.proveniencia.linha,
    )) {
      inserirDup(
        r.produto,
        r.composicao,
        r.classe,
        numero(r.idFarmaco),
        r.aviso,
        r.nota,
        fvId('site'),
        r.proveniencia.arquivo,
        r.proveniencia.linha,
      );
      (contas['site.duplicidade'] as Contagem).gravadas++;
    }

    // ---- P7: princípios ativos canônicos e mapeamento ----
    let mapa: SaidaMapeamento;
    try {
      mapa = mapear({
        medicamentos: paraMapear,
        farmacos: [...farmacos.entries()].map(([id, f]) => ({ id, nomeEn: f.nome })),
        decisoes: entradas.mapeamento.decisoes.decisoes,
        referencia: entradas.mapeamento.referencia,
      });
    } catch (erro) {
      if (erro instanceof ErroMapeamento) throw new ErroCarga(erro.message);
      throw erro;
    }
    for (const a of mapa.avisos) avisar('mapeamento', a);
    const inserirPrincipio = preparar(db, 'principio_ativo', ['slug', 'nome_pt', 'nome_en', 'atc']);
    const idPrincipio = new Map<string, number>();
    for (const p of mapa.principios) {
      idPrincipio.set(p.slug, inserirPrincipio(p.slug, p.nomePt, p.nomeEn, null));
    }
    const principioDe = (slug: string): number => idPrincipio.get(slug) as number;
    const inserirNome = preparar(db, 'principio_ativo_nome', [
      'principio_ativo_id',
      'idioma',
      'nome',
      'fonte',
    ]);
    for (const n of mapa.nomes) inserirNome(principioDe(n.slug), n.idioma, n.nome, n.fonte);
    const inserirMapeamento = preparar(db, 'mapeamento', [
      'origem',
      'chave_origem',
      'principio_ativo_id',
      'status',
      'motivo',
    ]);
    for (const m of mapa.mapeamentos) {
      inserirMapeamento(
        m.origem,
        m.chaveOrigem,
        m.slug === null ? null : principioDe(m.slug),
        m.status,
        m.motivo,
      );
    }
    const inserirLigacao = preparar(db, 'medicamento_principio', [
      'medicamento_id',
      'ordem',
      'principio_ativo_id',
      'concentracao',
    ]);
    for (const l of mapa.ligacoes)
      inserirLigacao(l.medicamentoId, l.ordem, principioDe(l.slug), null);
    const atualizarMed = db.prepare(
      'UPDATE medicamento SET componentes = ?, componentes_pendentes = ?, principio_truncado = ? WHERE id = ?',
    );
    for (const m of mapa.medicamentos) {
      if (m.componentes > 0) {
        atualizarMed.run(m.componentes, m.pendentes, m.truncado ? 1 : 0, m.medicamentoId);
      }
    }
    // Cada componente do texto da ANVISA vira uma ligação ou fica pendente. Em
    // `mapeamento.componentes`, "descartados" são os pendentes (sem princípio ativo).
    const totalComponentes = mapa.medicamentos.reduce((n, m) => n + m.componentes, 0);
    const pendentesTotal = mapa.medicamentos.reduce((n, m) => n + m.pendentes, 0);
    abrir('mapeamento.componentes', totalComponentes);
    (contas['mapeamento.componentes'] as Contagem).gravadas = mapa.ligacoes.length;
    (contas['mapeamento.componentes'] as Contagem).descartados = pendentesTotal;

    // ---- meta ----
    const versaoBase = versaoDasEntradas(entradas);
    const geradaAPartirDe = fontes
      .map((f) => f.fonte.baixadoEm)
      .sort()
      .at(-1) as string;
    const esquema = (migracoes.at(-1) as { nome: string }).nome;
    const inserirMeta = preparar(db, 'meta', ['chave', 'valor']);
    const fontesMeta = fontes.map(({ fonte }) => ({
      fonte: fonte.id,
      versao: fonte.versao,
      sha256: fonte.sha256,
      baixadoEm: fonte.baixadoEm,
    }));
    inserirMeta('esquema', esquema);
    inserirMeta('base_versao', versaoBase);
    inserirMeta('gerada_a_partir_de', geradaAPartirDe);
    inserirMeta('fontes', json(fontesMeta));
    inserirMeta(
      'licenca_dados',
      'CC BY-NC-SA 4.0 (DDInter 2.0); uso não comercial, com atribuição',
    );
    inserirMeta(
      'atribuicao_ddinter',
      `Interações medicamentosas: DDInter 2.0 (https://ddinter2.scbdd.com), licença CC BY-NC-SA 4.0. ` +
        `Conjuntos: downloads ${entradas.csv.fonte.versao}, exportações ${entradas.site.fonte.versao}, ` +
        `pares ${entradas.pares.fonte.versao}, manejo ${entradas.manejo.fonte.versao}. ` +
        `Dados reorganizados para o Doctorine.`,
    );
    inserirMeta(
      'atribuicao_anvisa',
      `Medicamentos registrados: dados abertos da ANVISA (dados.anvisa.gov.br), versão ${entradas.anvisa.fonte.versao}.`,
    );

    db.exec('COMMIT');
    reconstruirBusca(db);

    // ---- verificações e contagens ----
    const integrity = (db.prepare('PRAGMA integrity_check').get() as { integrity_check: string })
      .integrity_check;
    const fkProblemas = db.prepare('PRAGMA foreign_key_check').all().length;
    const nomesRepetidos = db
      .prepare('SELECT 1 FROM principio_ativo GROUP BY nome_pt HAVING count(*) > 1')
      .all().length;
    if (integrity !== 'ok') throw new Error(`integrity_check falhou: ${integrity}`);
    if (fkProblemas > 0) throw new Error(`foreign_key_check encontrou ${fkProblemas} problema(s)`);

    const tabelas: Record<string, number> = {};
    for (const t of [
      'fonte_versao',
      'medicamento',
      'ddinter_farmaco',
      'ddinter_texto',
      'ddinter_interacao',
      'ddinter_alternativa',
      'ddinter_alimento',
      'ddinter_doenca',
      'ddinter_duplicidade',
      'principio_ativo',
      'mapeamento',
      'medicamento_principio',
    ]) {
      tabelas[t] = Number((db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n);
    }
    for (const [nome, c] of Object.entries(contas)) {
      if (c.entrada !== c.gravadas + c.descartados) {
        throw new Error(
          `a conta de "${nome}" não fecha: ${c.entrada} lidos, ${c.gravadas} gravados, ${c.descartados} descartados`,
        );
      }
    }
    const paresComVarias = [...linhasPorPar.values()].filter((n) => n > 1).length;
    db.exec('VACUUM');
    db.close();
    renameSync(temporario, caminho);

    const bytes = readFileSync(caminho);
    const totalDescartes = Object.values(descartesPorMotivo).reduce((s, n) => s + n, 0);
    const totalAvisos = Object.values(avisosPorTipo).reduce((s, n) => s + n, 0);
    const relatorio: RelatorioCarga = {
      base: { versao: versaoBase, geradaAPartirDe, esquema },
      arquivo: {
        nome: caminho.split(/[\\/]/).at(-1) as string,
        bytes: statSync(caminho).size,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
      fontes: fontesMeta,
      contas: ordenado(contas),
      tabelas,
      descartes: {
        total: totalDescartes,
        porMotivo: ordenado(descartesPorMotivo),
        amostra: amostraDescartes,
      },
      avisos: { total: totalAvisos, porTipo: ordenado(avisosPorTipo), amostra: amostraAvisos },
      medicamento: {
        registrosLidos: regs.length,
        medicamentos: medicamentos.length,
        comMaisDeUmaLinha: comMaisDeUma,
        ativos: medicamentos.filter((m) => m.ativo).length,
        semNumeroDeRegistro: medicamentos.filter((m) => m.representante.numeroRegistro === null)
          .length,
        semPrincipioAtivo: semPrincipio,
        camposDiferentesEntreLinhas: ordenado(diferentes),
      },
      farmacos: { total: farmacos.size, comDrugbank, semDrugbank: farmacos.size - comDrugbank },
      interacoes: {
        total: tabelas['ddinter_interacao'] as number,
        emSiteECsv,
        soSite,
        soCsv,
        porGravidade: gravidades,
        paresComMaisDeUmaLinha: paresComVarias,
      },
      mapeamento: {
        versaoRegras: VERSAO_REGRAS,
        decisoes: entradas.mapeamento.decisoes.decisoes.length,
        principios: mapa.principios.length,
        principiosMesclados: mapa.principiosMesclados,
        cobertura: mapa.cobertura,
        filaDeRevisao: mapa.fila.length,
        regrasDeSalUsadas: mapa.regrasDeSalUsadas,
        referencia: {
          total: mapa.referencia.length,
          porSituacao: ordenado(
            mapa.referencia.reduce<Record<string, number>>((d, r) => {
              conta(d, r.situacao);
              return d;
            }, {}),
          ),
          semConfirmacao: mapa.referencia
            .filter((r) => r.situacao !== 'confirmado')
            .map((r) => ({ nome: r.nome, situacao: r.situacao })),
        },
      },
      verificacoes: {
        integrityCheck: integrity,
        foreignKeyCheck: fkProblemas,
        principiosComNomeRepetido: nomesRepetidos,
      },
    };
    return { relatorio, arquivo: caminho, mapeamento: mapa };
  } catch (erro) {
    try {
      db.close();
    } catch {
      // já fechado
    }
    rmSync(temporario, { force: true });
    throw erro;
  }
}

/** Grava o relatório (`.json` e `.md`) ao lado da base. */
export function escreverRelatorio(diretorio: string, r: RelatorioCarga, markdown: string): void {
  writeFileSync(join(diretorio, 'relatorio-carga.json'), JSON.stringify(r, null, 2) + '\n', 'utf8');
  writeFileSync(join(diretorio, 'relatorio-carga.md'), markdown, 'utf8');
}
