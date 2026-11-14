import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  conjuntoParaTeste,
  csvAmostra,
  emLatin1,
  jsonl,
  processarAnvisa,
  processarCsvs,
  processarSite,
  serializarAnvisa,
  serializarCsvs,
  serializarSite,
  type AlternativasRegistro,
  type FarmacoSite,
  type ParSite,
  type TextoManejo,
} from './fixtures-teste.js';
import { carregarBase, versaoDasEntradas } from './carregar.js';
import { executar } from './cli.js';
import {
  ErroCarga,
  farmacoCsv,
  lerEntradas,
  lerJsonl,
  localizar,
  relatorioDdinter,
} from './entrada.js';
import { relatorioEmMarkdown } from './relatorio.js';

let raiz: string;
beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), 'doctorine-base-'));
});
afterEach(() => rmSync(raiz, { recursive: true, force: true }));

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const abrir = (caminho: string): DatabaseSync => new DatabaseSync(caminho, { readOnly: true });
const todos = (db: DatabaseSync, sql: string) =>
  db.prepare(sql).all() as Array<Record<string, unknown>>;

function guardar(fonte: string, versao: string, arquivos: Record<string, string>): void {
  const pasta = join(raiz, 'data', 'processed', fonte, versao);
  mkdirSync(pasta, { recursive: true });
  for (const [nome, conteudo] of Object.entries(arquivos))
    writeFileSync(join(pasta, nome), conteudo, 'utf8');
}

/** Saídas reais dos pipelines (ANVISA, CSVs, site) e jsonl no formato de pares/manejo, tipados. */
function prepararRaiz(): void {
  const anvisa = processarAnvisa({
    bytes: emLatin1(csvAmostra()),
    arquivo: 'DADOS_ABERTOS_MEDICAMENTOS.csv',
    baixadoEm: '2026-11-12',
  });
  guardar('anvisa', anvisa.relatorio.fonte.versao, serializarAnvisa(anvisa));

  const csvs = processarCsvs({
    arquivos: conjuntoParaTeste.csvs(),
    baixadoEm: '2026-11-12',
    origem: 'manual',
  });
  guardar('ddinter', csvs.relatorio.fonte.versao, serializarCsvs(csvs));

  const site = processarSite({ arquivos: conjuntoParaTeste.site(), baixadoEm: '2026-11-12' });
  guardar('ddinter-site', site.relatorio.fonte.versao, serializarSite(site));

  const pares: ParSite[] = conjuntoParaTeste.pares;
  const paresTexto = jsonl(pares);
  const versaoPares = sha(paresTexto).slice(0, 12);
  guardar('ddinter-pares', versaoPares, {
    'pares.jsonl': paresTexto,
    'farmacos.jsonl': jsonl(conjuntoParaTeste.farmacosPares as FarmacoSite[]),
    'relatorio-qualidade.json': JSON.stringify({
      fonte: {
        id: 'ddinter-site-lista-de-pares',
        sha256: sha(paresTexto),
        versao: versaoPares,
        baixadoEm: '2026-11-13',
        baseUrl: 'https://site.invalid',
      },
    }),
  });

  const textos: TextoManejo[] = conjuntoParaTeste.textosManejo;
  const alternativas: AlternativasRegistro[] = conjuntoParaTeste.alternativas;
  const manejoTexto = jsonl(textos) + jsonl(alternativas);
  const versaoManejo = sha(manejoTexto).slice(0, 12);
  guardar('ddinter-manejo', versaoManejo, {
    'textos-manejo.jsonl': jsonl(textos),
    'alternativas.jsonl': jsonl(alternativas),
    'relatorio-qualidade.json': JSON.stringify({
      fonte: {
        id: 'ddinter-site-pagina-do-par',
        sha256: sha(manejoTexto),
        versao: versaoManejo,
        baixadoEm: '2026-11-14',
        baseUrl: 'https://site.invalid',
      },
    }),
  });
}

describe('carga a partir das saídas reais dos pipelines (contrato)', () => {
  it('lê o que os produtores escrevem e carrega sem descartes inesperados', () => {
    prepararRaiz();
    const entradas = lerEntradas(raiz);
    const { relatorio, arquivo } = carregarBase(entradas, join(raiz, 'saida', 'doctorine.sqlite'));
    expect(relatorio.verificacoes).toEqual({ integrityCheck: 'ok', foreignKeyCheck: 0 });
    // par 99 aponta para um texto que não existe: descartado, com motivo
    expect(relatorio.descartes.porMotivo).toEqual({
      'pares.site: texto inexistente nas exportações': 1,
    });
    for (const c of Object.values(relatorio.contas))
      expect(c.entrada).toBe(c.gravadas + c.descartados);

    const db = abrir(arquivo);
    expect(
      todos(db, 'SELECT fonte, versao FROM fonte_versao ORDER BY id').map((f) => f.fonte),
    ).toEqual([
      'anvisa-dados-abertos-medicamentos',
      'ddinter-downloads',
      'ddinter-site-exportacoes',
      'ddinter-site-lista-de-pares',
      'ddinter-site-pagina-do-par',
    ]);
  });

  it('une os pares do site e dos CSVs e padroniza a gravidade pelo pior caso', () => {
    prepararRaiz();
    const { relatorio, arquivo } = carregarBase(
      lerEntradas(raiz),
      join(raiz, 'saida', 'doctorine.sqlite'),
    );
    expect(relatorio.interacoes).toMatchObject({
      total: 10,
      emSiteECsv: 3,
      soSite: 2,
      soCsv: 5,
      paresComMaisDeUmaLinha: 1,
      porGravidade: { contraindicada: 0, grave: 3, moderada: 5, leve: 1, indeterminada: 1 },
    });
    const db = abrir(arquivo);
    const linha = (a: number, b: number, idPar: number | null) =>
      todos(
        db,
        `SELECT nivel_site, nivel_csv, csv_arquivos, gravidade, id_texto FROM ddinter_interacao
         WHERE farmaco_a_id = ${a} AND farmaco_b_id = ${b} AND id_par_site IS ${idPar}`,
      )[0];
    // site Major + CSV Minor: vale o pior caso, e os dois níveis originais ficam gravados
    expect(linha(1237, 1630, 3)).toEqual({
      nivel_site: 'Major',
      nivel_csv: 'Minor',
      csv_arquivos: 'H',
      gravidade: 'grave',
      id_texto: 9,
    });
    // só nos CSVs: sem texto, e "Unknown" vira indeterminada (nunca "leve" nem "sem interação")
    expect(linha(134, 458, null)).toEqual({
      nivel_site: null,
      nivel_csv: 'Unknown',
      csv_arquivos: 'P',
      gravidade: 'indeterminada',
      id_texto: null,
    });
    // mesmo par de medicamentos com dois ids no site: as duas linhas ficam
    expect(
      todos(
        db,
        'SELECT id_par_site FROM ddinter_interacao WHERE farmaco_a_id = 1 AND farmaco_b_id = 2 ORDER BY 1',
      ),
    ).toEqual([{ id_par_site: 4 }, { id_par_site: 5 }]);
  });

  it('liga o texto ao manejo e às referências, e guarda as alternativas por par', () => {
    prepararRaiz();
    const db = abrir(
      carregarBase(lerEntradas(raiz), join(raiz, 'saida', 'doctorine.sqlite')).arquivo,
    );
    const t = todos(db, 'SELECT * FROM ddinter_texto WHERE id = 9')[0] as Record<string, unknown>;
    expect(t['nivel_original']).toBe('Major');
    expect(t['manejo_en']).toBe('Evitar o uso conjunto.');
    expect(JSON.parse(t['referencias_json'] as string)).toEqual(['Ref A', 'Ref B']);
    expect(JSON.parse(t['mecanismos_json'] as string)).toEqual(['Synergy']);
    expect(t['id_par_manejo']).toBe(3);
    // texto sem página de manejo coletada: manejo nulo, e a fonte do manejo nula
    const sem = todos(
      db,
      'SELECT manejo_en, fonte_manejo_versao_id FROM ddinter_texto WHERE id = 7',
    )[0];
    expect(sem).toEqual({ manejo_en: null, fonte_manejo_versao_id: null });

    const alt = todos(db, 'SELECT * FROM ddinter_alternativa ORDER BY id')[0] as Record<
      string,
      unknown
    >;
    expect(alt['id_par_site']).toBe(3);
    expect(JSON.parse(alt['grupos_json'] as string)).toEqual([{ atc: 'C09A', farmacos: [10, 11] }]);
    expect(JSON.parse(alt['completo_json'] as string)).toEqual([10, 11, 12]);
    // as alternativas citadas viram medicamentos (a chave estrangeira não pode quebrar)
    expect(todos(db, 'SELECT nome_en FROM ddinter_farmaco WHERE id = 12')).toEqual([
      { nome_en: 'Nome12' },
    ]);
  });

  it('carrega alimento, doença e duplicidade com gravidade padronizada e referências separadas', () => {
    prepararRaiz();
    const db = abrir(
      carregarBase(lerEntradas(raiz), join(raiz, 'saida', 'doctorine.sqlite')).arquivo,
    );
    const alimentos = todos(
      db,
      'SELECT id, farmaco_id, gravidade, mecanismo_en, referencias_json FROM ddinter_alimento ORDER BY id',
    );
    expect(alimentos.map((a) => [a['id'], a['gravidade']])).toEqual([
      [1, 'moderada'],
      [121, 'moderada'],
      [788, 'grave'],
    ]);
    expect(alimentos[0]?.['mecanismo_en']).toBe('Absorption');
    expect(JSON.parse(alimentos[0]?.['referencias_json'] as string)).toHaveLength(2);
    expect(
      todos(db, 'SELECT gravidade FROM ddinter_doenca ORDER BY id').map((d) => d['gravidade']),
    ).toEqual(['grave', 'moderada', 'moderada']);
    expect(todos(db, 'SELECT count(*) AS n FROM ddinter_duplicidade')).toEqual([{ n: 1 }]);
  });

  it('junta os registros da ANVISA por número e mostra o que diferia entre eles', () => {
    prepararRaiz();
    const { relatorio, arquivo } = carregarBase(
      lerEntradas(raiz),
      join(raiz, 'saida', 'doctorine.sqlite'),
    );
    const m = relatorio.medicamento;
    expect(m.registrosLidos).toBe(relatorio.contas['anvisa.registros']?.entrada);
    expect(m.medicamentos).toBe(m.registrosLidos - 1); // TORVILIP: uma linha ativa e uma inativa
    expect(m.comMaisDeUmaLinha).toBe(1);
    expect(m.camposDiferentesEntreLinhas).toEqual({ principioAtivo: 1 });
    const db = abrir(arquivo);
    const torvilip = todos(
      db,
      "SELECT ativo, linhas_origem, situacao_registro, principio_ativo_original FROM medicamento WHERE numero_registro = '126750245'",
    );
    expect(torvilip).toEqual([
      {
        ativo: 1,
        linhas_origem: 2,
        situacao_registro: 'Ativo',
        principio_ativo_original: 'atorvastatina cálcica, ezetimiba',
      },
    ]);
    // registros de baixo risco, sem número, continuam um por linha
    expect(m.semNumeroDeRegistro).toBe(2);
  });

  it('deixa as tabelas do mapeamento vazias (são do P7) e a busca por nome funcionando', () => {
    prepararRaiz();
    const db = abrir(
      carregarBase(lerEntradas(raiz), join(raiz, 'saida', 'doctorine.sqlite')).arquivo,
    );
    for (const t of ['principio_ativo', 'mapeamento', 'medicamento_principio']) {
      expect(todos(db, `SELECT count(*) AS n FROM ${t}`)).toEqual([{ n: 0 }]);
    }
    const achar = (q: string) =>
      todos(
        db,
        `SELECT m.nome_produto FROM busca_medicamento b JOIN medicamento m ON m.id = b.rowid WHERE busca_medicamento MATCH '${q}'`,
      );
    expect(achar('agua injecao')).toEqual([{ nome_produto: 'ÁGUA PARA INJEÇÃO' }]);
    expect(achar('torvil*')).toHaveLength(1);
    expect(
      todos(
        db,
        "SELECT id FROM busca_ddinter_farmaco b JOIN ddinter_farmaco f ON f.id = b.rowid WHERE busca_ddinter_farmaco MATCH 'abacavir'",
      ),
    ).toEqual([{ id: 1 }]);
  });

  it('guarda a atribuição e a licença na própria base', () => {
    prepararRaiz();
    const db = abrir(
      carregarBase(lerEntradas(raiz), join(raiz, 'saida', 'doctorine.sqlite')).arquivo,
    );
    const meta = Object.fromEntries(
      todos(db, 'SELECT chave, valor FROM meta').map((r) => [r['chave'], r['valor']]),
    );
    expect(meta['licenca_dados']).toMatch(/CC BY-NC-SA 4\.0/);
    expect(meta['atribuicao_ddinter']).toMatch(/DDInter 2\.0.*CC BY-NC-SA 4\.0/);
    expect(meta['esquema']).toBe('0001_busca');
    expect(meta['gerada_a_partir_de']).toBe('2026-11-14');
  });
});

describe('robustez', () => {
  it('registra os medicamentos citados pelos próprios pares, mesmo sem farmacos.jsonl', () => {
    prepararRaiz();
    const e = lerEntradas(raiz);
    e.pares.farmacos = [];
    e.csv.farmacos = [];
    const { relatorio, arquivo } = carregarBase(e, join(raiz, 'saida', 'doctorine.sqlite'));
    expect(relatorio.verificacoes.foreignKeyCheck).toBe(0);
    expect(
      todos(abrir(arquivo), 'SELECT nome_en, drugbank FROM ddinter_farmaco WHERE id = 1237'),
    ).toEqual([{ nome_en: 'Moexipril', drugbank: 'DB00691' }]);
  });

  it('avisa quando as fontes dão nomes diferentes ao mesmo medicamento e fica com a de maior prioridade', () => {
    prepararRaiz();
    const e = lerEntradas(raiz);
    const csv = e.csv.interacoes.find((i) => i.idA === 'DDInter1' && i.idB === 'DDInter228');
    (csv as { nomeB: string }).nomeB = 'Outro nome';
    const { relatorio, arquivo } = carregarBase(e, join(raiz, 'saida', 'doctorine.sqlite'));
    expect(relatorio.avisos.porTipo['nome-diferente-entre-fontes']).toBeGreaterThanOrEqual(1);
    expect(todos(abrir(arquivo), 'SELECT nome_en FROM ddinter_farmaco WHERE id = 228')).toEqual([
      { nome_en: 'Brentuximab vedotin' },
    ]);
  });
});

describe('idempotência', () => {
  it('duas cargas das mesmas entradas geram o mesmo arquivo, byte a byte, e o mesmo relatório', () => {
    prepararRaiz();
    const a = carregarBase(lerEntradas(raiz), join(raiz, 'a', 'doctorine.sqlite'));
    const b = carregarBase(lerEntradas(raiz), join(raiz, 'b', 'doctorine.sqlite'));
    expect(a.relatorio.arquivo.sha256).toBe(b.relatorio.arquivo.sha256);
    expect(readFileSync(a.arquivo).equals(readFileSync(b.arquivo))).toBe(true);
    expect(relatorioEmMarkdown(a.relatorio)).toBe(relatorioEmMarkdown(b.relatorio));
  });

  it('a ordem das linhas de entrada não muda o arquivo gerado', () => {
    prepararRaiz();
    const e1 = lerEntradas(raiz);
    const e2 = lerEntradas(raiz);
    e2.pares.pares.reverse();
    e2.csv.interacoes.reverse();
    e2.site.textos.reverse();
    e2.site.alimentos.reverse();
    e2.manejo.alternativas.reverse();
    e2.anvisa.registros.reverse();
    const a = carregarBase(e1, join(raiz, 'a', 'doctorine.sqlite'));
    const b = carregarBase(e2, join(raiz, 'b', 'doctorine.sqlite'));
    expect(b.relatorio.arquivo.sha256).toBe(a.relatorio.arquivo.sha256);
  });

  it('a versão da base muda quando muda a versão de uma fonte', () => {
    prepararRaiz();
    const e = lerEntradas(raiz);
    const antes = versaoDasEntradas(e);
    e.manejo.fonte = { ...e.manejo.fonte, versao: '000000000000' };
    expect(versaoDasEntradas(e)).not.toBe(antes);
  });

  it('não deixa arquivo parcial quando a carga falha', () => {
    prepararRaiz();
    const e = lerEntradas(raiz);
    // o parceiro citado pela página não existe entre os medicamentos: erro de dados, não se adivinha
    (e.manejo.alternativas[0] as { idParceiro: string | null }).idParceiro = 'DDInter777777';
    const destino = join(raiz, 'saida', 'doctorine.sqlite');
    expect(() => carregarBase(e, destino)).toThrow(/FOREIGN KEY/);
    expect(existsSync(destino)).toBe(false);
    expect(existsSync(`${destino}.tmp`)).toBe(false);
  });
});

describe('leitura das entradas', () => {
  it('recusa uma linha fora do formato dizendo o arquivo e a linha', () => {
    prepararRaiz();
    const e = join(raiz, 'ruim.jsonl');
    writeFileSync(e, '{"id":"DDInter1","nome":"x"}\n{"id":"errado","nome":"y"}\n', 'utf8');
    expect(() => lerJsonl(e, farmacoCsv)).toThrow(/ruim\.jsonl, linha 2: id/);
  });

  it('recusa JSON inválido e arquivo ausente', () => {
    const e = join(raiz, 'x.jsonl');
    writeFileSync(e, '{nao é json}\n', 'utf8');
    expect(() => lerJsonl(e, farmacoCsv)).toThrow(/linha 1: JSON inválido/);
    expect(() => lerJsonl(join(raiz, 'nao-existe.jsonl'), farmacoCsv)).toThrow(ErroCarga);
  });

  it('recusa uma pasta cujo relatório é de outra versão', () => {
    prepararRaiz();
    const pasta = join(raiz, 'data', 'processed', 'ddinter');
    const versao = lerEntradas(raiz).csv.fonte.versao;
    const caminho = join(pasta, versao, 'relatorio-qualidade.json');
    const r = JSON.parse(readFileSync(caminho, 'utf8'));
    r.fonte.versao = '111111111111';
    writeFileSync(caminho, JSON.stringify(r));
    expect(() => localizar(raiz, 'ddinter', relatorioDdinter)).toThrow(
      /relatório diz versão 111111111111/,
    );
  });

  it('escolhe a versão mais recente e aceita escolher outra', () => {
    prepararRaiz();
    // uma segunda versão dos CSVs, baixada depois
    const csvs = processarCsvs({
      arquivos: conjuntoParaTeste.csvs(['DDInter5,Cinco,DDInter6,Seis,Major']),
      baixadoEm: '2026-11-13',
      origem: 'manual',
    });
    guardar('ddinter', csvs.relatorio.fonte.versao, serializarCsvs(csvs));
    expect(localizar(raiz, 'ddinter', relatorioDdinter).fonte.versao).toBe(
      csvs.relatorio.fonte.versao,
    );
    expect(lerEntradas(raiz).csv.fonte.versao).toBe(csvs.relatorio.fonte.versao);
    const outra = readdirSync(join(raiz, 'data', 'processed', 'ddinter')).find(
      (v) => v !== csvs.relatorio.fonte.versao,
    ) as string;
    expect(localizar(raiz, 'ddinter', relatorioDdinter, outra).fonte.versao).toBe(outra);
    expect(() => localizar(raiz, 'ddinter', relatorioDdinter, 'ffffffffffff')).toThrow(
      /não encontrada/,
    );
  });

  it('explica quando uma fonte ainda não foi processada', () => {
    expect(() => lerEntradas(raiz)).toThrow(/nenhuma saída de "anvisa"/);
  });
});

describe('CLI', () => {
  it('gera a base em data/processed/base/<versão>/ com o relatório, e repete sem mudar nada', () => {
    prepararRaiz();
    const log = console.log;
    console.log = () => undefined;
    try {
      expect(executar(['--raiz', raiz])).toBe(0);
      const versao = versaoDasEntradas(lerEntradas(raiz));
      const arq = join(raiz, 'data', 'processed', 'base', versao, 'doctorine.sqlite');
      const primeiro = readFileSync(arq);
      const md = readFileSync(
        join(raiz, 'data', 'processed', 'base', versao, 'relatorio-carga.md'),
        'utf8',
      );
      expect(md).toContain('A conta fecha');
      expect(md).toContain('## Descartes');
      expect(executar(['--raiz', raiz])).toBe(0);
      expect(readFileSync(arq).equals(primeiro)).toBe(true);
    } finally {
      console.log = log;
    }
  });

  it('devolve 1 com a explicação quando falta uma fonte', () => {
    const erro = console.error;
    const mensagens: string[] = [];
    console.error = (m: string) => void mensagens.push(m);
    try {
      expect(executar(['--raiz', raiz])).toBe(1);
      expect(mensagens[0]).toMatch(/^Erro: nenhuma saída de "anvisa"/);
    } finally {
      console.error = erro;
    }
  });
});
