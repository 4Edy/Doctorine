/**
 * Esquema da base Doctorine (SQLite). Fonte de verdade das tabelas; a migração SQL em `drizzle/` é
 * gerada a partir daqui (`pnpm --filter @doctorine/database gerar-migracao`). Decisões e motivos em
 * docs/adr/0005-modelo-de-dados.md e docs/modelo-de-dados.md.
 *
 * Três camadas:
 * - **proveniência**: `fonte_versao` (de onde veio cada dado) e `meta` (versão da base);
 * - **fontes**, como vieram, já validadas: `medicamento` (ANVISA) e `ddinter_*`;
 * - **canônica**: `principio_ativo`, nomes, `mapeamento` e `medicamento_principio`. Existe desde a
 *   primeira migração, mas só é preenchida no P7 (mapeamento), com revisão da farmacêutica.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { GRAVIDADES, NIVEIS_ORIGINAIS } from './gravidade.js';

const lista = (valores: readonly string[]) =>
  sql.raw(valores.map((v) => `'${v.replace(/'/g, "''")}'`).join(', '));

// ---------------------------------------------------------------------------------------------
// Proveniência

/** Pares chave/valor da base: versão do esquema, versão da base e atribuição das fontes. */
export const meta = sqliteTable('meta', {
  chave: text('chave').primaryKey(),
  valor: text('valor').notNull(),
});

/** Cada conjunto de dados carregado: fonte, versão (12 primeiros do SHA-256), data e checksum. */
export const fonteVersao = sqliteTable(
  'fonte_versao',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    fonte: text('fonte').notNull(),
    versao: text('versao').notNull(),
    sha256: text('sha256').notNull(),
    /** AAAA-MM-DD do download ou da coleta. */
    baixadoEm: text('baixado_em').notNull(),
    /** download, manual ou coleta, quando a fonte informa. */
    origem: text('origem'),
    url: text('url'),
  },
  (t) => [unique('fonte_versao_unica').on(t.fonte, t.versao)],
);

// ---------------------------------------------------------------------------------------------
// ANVISA

/**
 * Medicamento brasileiro, uma linha por número de registro (e uma por registro sem número, como os
 * de baixo risco). O arquivo da ANVISA repete o mesmo registro com situação diferente (Ativo e
 * Inativo): aqui eles viram um só, `ativo` = alguma linha ativa. Campos copiados da linha
 * representante (a ativa, ou a primeira); `linhasOrigem` diz quantas linhas foram juntadas.
 */
export const medicamento = sqliteTable(
  'medicamento',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    numeroRegistro: text('numero_registro'),
    nomeProduto: text('nome_produto').notNull(),
    tipoProduto: text('tipo_produto').notNull(),
    categoriaRegulatoria: text('categoria_regulatoria'),
    classeTerapeutica: text('classe_terapeutica'),
    empresaCnpj: text('empresa_cnpj'),
    empresaNome: text('empresa_nome'),
    numeroProcesso: text('numero_processo'),
    /** AAAA-MM-DD */
    dataFinalizacaoProcesso: text('data_finalizacao_processo'),
    /** AAAA-MM */
    vencimentoRegistro: text('vencimento_registro'),
    /** Situação da linha representante, como veio (Ativo, Inativo). */
    situacaoRegistro: text('situacao_registro').notNull(),
    ativo: integer('ativo').notNull(),
    /** Texto original da ANVISA, sem separar. Separar em princípios ativos é o P7. */
    principioAtivoOriginal: text('principio_ativo_original'),
    linhasOrigem: integer('linhas_origem').notNull(),
    fonteVersaoId: integer('fonte_versao_id')
      .notNull()
      .references(() => fonteVersao.id),
    /** Linha da linha representante no arquivo de origem (base 1). */
    linha: integer('linha').notNull(),
  },
  (t) => [
    uniqueIndex('medicamento_numero_registro_unico').on(t.numeroRegistro),
    index('medicamento_nome').on(t.nomeProduto),
    check('medicamento_ativo_booleano', sql`${t.ativo} in (0, 1)`),
    check('medicamento_linhas_origem_positivas', sql`${t.linhasOrigem} >= 1`),
  ],
);

// ---------------------------------------------------------------------------------------------
// Camada canônica (preenchida no P7)

export const principioAtivo = sqliteTable(
  'principio_ativo',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Chave estável entre versões da base: minúsculas, sem acento, hífens. */
    slug: text('slug').notNull(),
    /** Nome oficial em português (DCB/ANVISA). Nunca vem de tradução automática. */
    nomePt: text('nome_pt').notNull(),
    nomeEn: text('nome_en'),
    /** Código ATC de 7 caracteres, quando houver (por exemplo, N02BE01). */
    atc: text('atc'),
  },
  (t) => [
    uniqueIndex('principio_ativo_slug_unico').on(t.slug),
    check(
      'principio_ativo_slug_formato',
      sql`${t.slug} glob '[a-z0-9]*' and ${t.slug} not glob '*[^a-z0-9-]*'`,
    ),
  ],
);

export const principioAtivoNome = sqliteTable(
  'principio_ativo_nome',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    principioAtivoId: integer('principio_ativo_id')
      .notNull()
      .references(() => principioAtivo.id),
    idioma: text('idioma', { enum: ['pt', 'en'] }).notNull(),
    nome: text('nome').notNull(),
    /** De onde vem este nome (por exemplo, anvisa, ddinter, glossario). */
    fonte: text('fonte').notNull(),
  },
  (t) => [
    unique('principio_ativo_nome_unico').on(t.principioAtivoId, t.idioma, t.nome),
    index('principio_ativo_nome_busca').on(t.nome),
    check('principio_ativo_nome_idioma', sql`${t.idioma} in ('pt', 'en')`),
  ],
);

export const ORIGENS_MAPEAMENTO = ['ddinter-farmaco', 'anvisa-componente'] as const;
export const STATUS_MAPEAMENTO = ['automatico', 'confirmado', 'pendente'] as const;

/**
 * Liga um nome de uma fonte a um princípio ativo canônico. `ddinter-farmaco`: a chave é o
 * identificador numérico do DDInter. `anvisa-componente`: a chave é o nome de um componente do
 * texto de princípio ativo da ANVISA, já separado e normalizado (P7).
 *
 * Pendente é o único status sem princípio ativo: o item aparece como não verificado, nunca como
 * "sem interação".
 */
export const mapeamento = sqliteTable(
  'mapeamento',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    origem: text('origem', { enum: ORIGENS_MAPEAMENTO }).notNull(),
    chaveOrigem: text('chave_origem').notNull(),
    principioAtivoId: integer('principio_ativo_id').references(() => principioAtivo.id),
    status: text('status', { enum: STATUS_MAPEAMENTO }).notNull(),
    /** Por que o caso é ambíguo ou como foi decidido (sal, hidrato, grafia). */
    motivo: text('motivo'),
  },
  (t) => [
    unique('mapeamento_unico').on(t.origem, t.chaveOrigem),
    index('mapeamento_principio').on(t.principioAtivoId),
    check('mapeamento_origem', sql`${t.origem} in (${lista(ORIGENS_MAPEAMENTO)})`),
    check('mapeamento_status', sql`${t.status} in (${lista(STATUS_MAPEAMENTO)})`),
    check(
      'mapeamento_pendente_sem_principio',
      sql`(${t.status} = 'pendente') = (${t.principioAtivoId} is null)`,
    ),
  ],
);

/** Princípios ativos de um medicamento, com a concentração quando a fonte a informa. */
export const medicamentoPrincipio = sqliteTable(
  'medicamento_principio',
  {
    medicamentoId: integer('medicamento_id')
      .notNull()
      .references(() => medicamento.id),
    /** Posição do componente no texto original (base 1). */
    ordem: integer('ordem').notNull(),
    principioAtivoId: integer('principio_ativo_id')
      .notNull()
      .references(() => principioAtivo.id),
    concentracao: text('concentracao'),
  },
  (t) => [
    primaryKey({ columns: [t.medicamentoId, t.ordem] }),
    index('medicamento_principio_principio').on(t.principioAtivoId),
    check('medicamento_principio_ordem', sql`${t.ordem} >= 1`),
  ],
);

// ---------------------------------------------------------------------------------------------
// DDInter

/**
 * Medicamento do DDInter (em inglês). A chave é o número do identificador (`DDInter1237` vira
 * 1237). Nome e DrugBank vêm da fonte mais completa que o cita; `fonteVersaoId` diz qual.
 */
export const ddinterFarmaco = sqliteTable(
  'ddinter_farmaco',
  {
    id: integer('id').primaryKey(),
    nomeEn: text('nome_en').notNull(),
    drugbank: text('drugbank'),
    fonteVersaoId: integer('fonte_versao_id')
      .notNull()
      .references(() => fonteVersao.id),
  },
  (t) => [
    index('ddinter_farmaco_nome').on(t.nomeEn),
    index('ddinter_farmaco_drugbank').on(t.drugbank),
  ],
);

/**
 * Texto de uma interação entre medicamentos (inglês). Vale para todos os pares ligados a ele:
 * descrição, manejo e referências são do texto, não do par (conferido em 50 de 50 amostras).
 * A tradução (P8) fica em tabela própria; aqui o original nunca muda.
 */
export const ddinterTexto = sqliteTable(
  'ddinter_texto',
  {
    id: integer('id').primaryKey(),
    nivelOriginal: text('nivel_original', { enum: NIVEIS_ORIGINAIS }).notNull(),
    descricaoEn: text('descricao_en'),
    manejoEn: text('manejo_en'),
    /** Lista JSON dos mecanismos marcados (Absorption, Metabolism...). */
    mecanismosJson: text('mecanismos_json').notNull().default('[]'),
    /** Lista JSON de referências, na ordem da página; podem ter perdido acentos na origem. */
    referenciasJson: text('referencias_json').notNull().default('[]'),
    /** Par cuja página trouxe o manejo e as referências. */
    idParManejo: integer('id_par_manejo'),
    fonteTextoVersaoId: integer('fonte_texto_versao_id')
      .notNull()
      .references(() => fonteVersao.id),
    arquivoTexto: text('arquivo_texto').notNull(),
    linhaTexto: integer('linha_texto').notNull(),
    fonteManejoVersaoId: integer('fonte_manejo_versao_id').references(() => fonteVersao.id),
  },
  (t) => [check('ddinter_texto_nivel', sql`${t.nivelOriginal} in (${lista(NIVEIS_ORIGINAIS)})`)],
);

/**
 * Interação entre dois medicamentos (união das duas fontes de pares do DDInter). Uma linha por par
 * do site (`idParSite`); os pares que só os 8 CSVs têm entram sem texto e com `nivelSite` nulo.
 * O mesmo par de medicamentos pode ter várias linhas (7.330 pares têm mais de um id no site): todas
 * ficam, e o motor decide como mostrar. `farmacoAId` < `farmacoBId`: o par não tem direção.
 *
 * `gravidade` = a mais grave entre as classificações originais presentes (ver `gravidade.ts`).
 */
export const ddinterInteracao = sqliteTable(
  'ddinter_interacao',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    farmacoAId: integer('farmaco_a_id')
      .notNull()
      .references(() => ddinterFarmaco.id),
    farmacoBId: integer('farmaco_b_id')
      .notNull()
      .references(() => ddinterFarmaco.id),
    idParSite: integer('id_par_site'),
    idTexto: integer('id_texto').references(() => ddinterTexto.id),
    /** Nível do par na lista do site (3 = Major, 2 = Moderate, 1 = Minor). */
    nivelSite: text('nivel_site', { enum: NIVEIS_ORIGINAIS }),
    /** Nível nos 8 CSVs de download; null se o par não está neles. */
    nivelCsv: text('nivel_csv', { enum: NIVEIS_ORIGINAIS }),
    /** Letras dos CSVs em que o par aparece (por exemplo, A,L). */
    csvArquivos: text('csv_arquivos'),
    gravidade: text('gravidade', { enum: GRAVIDADES }).notNull(),
    /** Lista JSON dos mecanismos marcados no par. */
    mecanismosJson: text('mecanismos_json').notNull().default('[]'),
    fontePareVersaoId: integer('fonte_par_versao_id').references(() => fonteVersao.id),
    fonteCsvVersaoId: integer('fonte_csv_versao_id').references(() => fonteVersao.id),
  },
  (t) => [
    index('ddinter_interacao_par').on(t.farmacoAId, t.farmacoBId),
    index('ddinter_interacao_b').on(t.farmacoBId),
    index('ddinter_interacao_texto').on(t.idTexto),
    index('ddinter_interacao_par_site').on(t.idParSite),
    /** O mesmo id de par pode estar em mais de um texto, mas nunca duas vezes no mesmo. */
    uniqueIndex('ddinter_interacao_par_texto_unico').on(t.idParSite, t.idTexto),
    check('ddinter_interacao_sem_direcao', sql`${t.farmacoAId} < ${t.farmacoBId}`),
    check('ddinter_interacao_gravidade', sql`${t.gravidade} in (${lista(GRAVIDADES)})`),
    check(
      'ddinter_interacao_nivel_site',
      sql`${t.nivelSite} is null or ${t.nivelSite} in (${lista(NIVEIS_ORIGINAIS)})`,
    ),
    check(
      'ddinter_interacao_nivel_csv',
      sql`${t.nivelCsv} is null or ${t.nivelCsv} in (${lista(NIVEIS_ORIGINAIS)})`,
    ),
    check(
      'ddinter_interacao_tem_fonte',
      sql`${t.nivelSite} is not null or ${t.nivelCsv} is not null`,
    ),
    check(
      'ddinter_interacao_site_com_texto',
      sql`(${t.nivelSite} is null) = (${t.idParSite} is null) and (${t.idParSite} is null) = (${t.idTexto} is null)`,
    ),
  ],
);

/**
 * Alternativas que a página de um par lista para um dos medicamentos. Dependem do par (o mesmo
 * medicamento tem listas diferentes conforme o parceiro) e só existem para o par lido de cada
 * texto. Guardam só identificadores; os nomes estão em `ddinter_farmaco`.
 */
export const ddinterAlternativa = sqliteTable(
  'ddinter_alternativa',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    idParSite: integer('id_par_site').notNull(),
    idTexto: integer('id_texto')
      .notNull()
      .references(() => ddinterTexto.id),
    farmacoId: integer('farmaco_id')
      .notNull()
      .references(() => ddinterFarmaco.id),
    parceiroId: integer('parceiro_id').references(() => ddinterFarmaco.id),
    /** JSON: [{ "atc": "C09A", "farmacos": [ids] }], os grupos que a tabela da página mostra. */
    gruposJson: text('grupos_json').notNull(),
    /** JSON: lista completa de identificadores (a que o script da página guarda). */
    completoJson: text('completo_json').notNull(),
    fonteVersaoId: integer('fonte_versao_id')
      .notNull()
      .references(() => fonteVersao.id),
  },
  (t) => [
    index('ddinter_alternativa_par').on(t.idParSite),
    index('ddinter_alternativa_farmaco').on(t.farmacoId),
  ],
);

/** Medicamento × alimento. O DDInter 2.0 cobre poucos alimentos (29). */
export const ddinterAlimento = sqliteTable(
  'ddinter_alimento',
  {
    id: integer('id').primaryKey(),
    farmacoId: integer('farmaco_id')
      .notNull()
      .references(() => ddinterFarmaco.id),
    alimentoEn: text('alimento_en').notNull(),
    nivelOriginal: text('nivel_original', { enum: NIVEIS_ORIGINAIS }).notNull(),
    gravidade: text('gravidade', { enum: GRAVIDADES }).notNull(),
    /** Vem da coluna `magnesium` da exportação, que na verdade é o mecanismo. */
    mecanismoEn: text('mecanismo_en'),
    interacaoEn: text('interacao_en').notNull(),
    manejoEn: text('manejo_en').notNull(),
    referenciasJson: text('referencias_json').notNull().default('[]'),
    fonteVersaoId: integer('fonte_versao_id')
      .notNull()
      .references(() => fonteVersao.id),
    arquivo: text('arquivo').notNull(),
    linha: integer('linha').notNull(),
  },
  (t) => [
    index('ddinter_alimento_farmaco').on(t.farmacoId),
    index('ddinter_alimento_alimento').on(t.alimentoEn),
    check('ddinter_alimento_nivel', sql`${t.nivelOriginal} in (${lista(NIVEIS_ORIGINAIS)})`),
    check('ddinter_alimento_gravidade', sql`${t.gravidade} in (${lista(GRAVIDADES)})`),
  ],
);

/** Medicamento × doença. Mais de um registro para o mesmo par é normal: cada um tem texto próprio. */
export const ddinterDoenca = sqliteTable(
  'ddinter_doenca',
  {
    id: integer('id').primaryKey(),
    farmacoId: integer('farmaco_id')
      .notNull()
      .references(() => ddinterFarmaco.id),
    doencaEn: text('doenca_en').notNull(),
    nivelOriginal: text('nivel_original', { enum: NIVEIS_ORIGINAIS }).notNull(),
    gravidade: text('gravidade', { enum: GRAVIDADES }).notNull(),
    textoEn: text('texto_en').notNull(),
    referenciasJson: text('referencias_json').notNull().default('[]'),
    fonteVersaoId: integer('fonte_versao_id')
      .notNull()
      .references(() => fonteVersao.id),
    arquivo: text('arquivo').notNull(),
    linha: integer('linha').notNull(),
  },
  (t) => [
    index('ddinter_doenca_farmaco').on(t.farmacoId),
    index('ddinter_doenca_doenca').on(t.doencaEn),
    check('ddinter_doenca_nivel', sql`${t.nivelOriginal} in (${lista(NIVEIS_ORIGINAIS)})`),
    check('ddinter_doenca_gravidade', sql`${t.gravidade} in (${lista(GRAVIDADES)})`),
  ],
);

/** Produto combinado × medicamento isolado, por classe terapêutica. Não cobre dois isolados. */
export const ddinterDuplicidade = sqliteTable(
  'ddinter_duplicidade',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    produto: text('produto').notNull(),
    composicao: text('composicao').notNull(),
    classe: text('classe').notNull(),
    farmacoId: integer('farmaco_id')
      .notNull()
      .references(() => ddinterFarmaco.id),
    aviso: text('aviso').notNull(),
    nota: text('nota').notNull(),
    fonteVersaoId: integer('fonte_versao_id')
      .notNull()
      .references(() => fonteVersao.id),
    arquivo: text('arquivo').notNull(),
    linha: integer('linha').notNull(),
  },
  (t) => [index('ddinter_duplicidade_farmaco').on(t.farmacoId)],
);
