import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { carregarBase, escreverRelatorio, versaoDasEntradas } from './carregar.js';
import { ErroCarga, lerEntradas, type Versoes } from './entrada.js';
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
    const entradas = lerEntradas(raiz, versoes);
    const versao = versaoDasEntradas(entradas);
    const diretorio = join(raiz, 'data', 'processed', 'base', versao);
    mkdirSync(diretorio, { recursive: true });
    const { relatorio } = carregarBase(entradas, join(diretorio, 'doctorine.sqlite'));
    escreverRelatorio(diretorio, relatorio, relatorioEmMarkdown(relatorio));
    console.log(`Base ${versao} gerada em ${diretorio}`);
    console.log(
      `  ${relatorio.tabelas['medicamento']} medicamentos, ${relatorio.tabelas['ddinter_interacao']} interações, ` +
        `${relatorio.descartes.total} descartes, ${relatorio.avisos.total} avisos`,
    );
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
