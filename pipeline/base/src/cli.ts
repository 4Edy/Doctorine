import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { carregarBase, escreverRelatorio, versaoDasEntradas } from './carregar.js';
import { ErroCarga, lerEntradas, type Versoes } from './entrada.js';
import { escreverArquivosDoMapeamento } from './arquivos-mapeamento.js';
import { relatorioEmMarkdown } from './relatorio.js';

const AJUDA = `Uso: pnpm pipeline:base [opções]

Gera data/processed/base/<versão>/doctorine.sqlite a partir das saídas processadas em
data/processed (anvisa, ddinter, ddinter-site, ddinter-pares, ddinter-manejo). Sem opções, usa a
versão de download mais recente de cada fonte.

  --raiz <pasta>      raiz do repositório (padrão: pasta atual)
  --anvisa <versão>   versão da ANVISA
  --ddinter <versão>  versão dos 8 CSVs de pares
  --site <versão>     versão das exportações do site
  --pares <versão>    versão da lista de pares
  --manejo <versão>   versão do manejo e das alternativas
  --decisoes <arquivo>  decisões do mapeamento (padrão: data/mapeamento/decisoes.json)
  --referencia <arquivo>  conjunto de referência (padrão: data/reference-set/pairs.json)
  --classes-dcb <arquivo>  classes da DCB (padrão: data/mapeamento/classes-dcb.json)
  --exigir-referencia   termina com erro se algum nome do conjunto de referência não estiver
                        confirmado pela farmacêutica (critério de conclusão do P7)
`;

export function executar(argv: readonly string[]): number {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      raiz: { type: 'string' },
      anvisa: { type: 'string' },
      ddinter: { type: 'string' },
      site: { type: 'string' },
      pares: { type: 'string' },
      manejo: { type: 'string' },
      decisoes: { type: 'string' },
      referencia: { type: 'string' },
      'classes-dcb': { type: 'string' },
      'exigir-referencia': { type: 'boolean' },
      ajuda: { type: 'boolean', short: 'h' },
    },
  });
  if (values.ajuda) {
    console.log(AJUDA);
    return 0;
  }
  // `pnpm --filter` roda na pasta do pacote; INIT_CWD é onde o comando foi digitado.
  const raiz = resolve(values.raiz ?? process.env['INIT_CWD'] ?? process.cwd());
  const versoes: Versoes = {};
  for (const k of ['anvisa', 'ddinter', 'site', 'pares', 'manejo'] as const) {
    const v = values[k];
    if (v !== undefined) versoes[k] = v;
  }
  try {
    const entradas = lerEntradas(raiz, versoes, {
      ...(values.decisoes !== undefined ? { decisoes: resolve(values.decisoes) } : {}),
      ...(values.referencia !== undefined ? { referencia: resolve(values.referencia) } : {}),
      ...(values['classes-dcb'] !== undefined
        ? { classesDcb: resolve(values['classes-dcb']) }
        : {}),
    });
    const versao = versaoDasEntradas(entradas);
    const diretorio = join(raiz, 'data', 'processed', 'base', versao);
    mkdirSync(diretorio, { recursive: true });
    const { relatorio, mapeamento } = carregarBase(entradas, join(diretorio, 'doctorine.sqlite'));
    escreverRelatorio(diretorio, relatorio, relatorioEmMarkdown(relatorio));
    escreverArquivosDoMapeamento(diretorio, mapeamento);
    console.log(`Base ${versao} gerada em ${diretorio}`);
    console.log(
      `  ${relatorio.tabelas['medicamento']} medicamentos, ${relatorio.tabelas['ddinter_interacao']} interações, ` +
        `${relatorio.descartes.total} descartes, ${relatorio.avisos.total} avisos`,
    );
    const c = relatorio.mapeamento.cobertura;
    console.log(
      `  mapeamento: ${c.percentualCompletos}% dos medicamentos ativos com todos os princípios ativos mapeados; ` +
        `${relatorio.mapeamento.filaDeRevisao} componentes na fila de revisão (mapeamento-fila.csv)`,
    );
    const faltam = relatorio.mapeamento.referencia.semConfirmacao;
    if (faltam.length > 0) {
      console.log(
        `  conjunto de referência: ${faltam.length} nome(s) sem confirmação: ${faltam.map((f) => `${f.nome} (${f.situacao})`).join(', ')}`,
      );
      if (values['exigir-referencia']) {
        console.error('Erro: o conjunto de referência tem nomes sem confirmação da farmacêutica.');
        return 1;
      }
    }
    return 0;
  } catch (erro) {
    if (erro instanceof ErroCarga) {
      console.error(`Erro: ${erro.message}`);
      return 1;
    }
    throw erro;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('cli.ts')) {
  process.exitCode = executar(process.argv.slice(2));
}
