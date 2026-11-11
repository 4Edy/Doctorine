import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { baixar, ultimoDownload, URL_PADRAO } from './baixar.js';
import { processarDownload } from './executar.js';
import { ErroArquivo } from './processar.js';

export interface SaidaCli {
  /** 0 = ok, 1 = falha no download ou no arquivo, 2 = uso incorreto. */
  codigo: 0 | 1 | 2;
  linhas: string[];
}

export interface Dependencias {
  /** Raiz do repositório; os caminhos de dados saem dela. */
  raiz: string;
  buscar?: typeof fetch;
  agora?: () => Date;
}

const USO = `Uso: pipeline-anvisa <baixar | processar | tudo> [--url <endereço>]

  baixar      baixa o CSV da ANVISA para data/raw/anvisa/<versão>/ com manifesto e checksum
  processar   lê o download mais recente e gera registros, rejeições e relatório de qualidade
              em data/processed/anvisa/<versão>/
  tudo        baixar + processar`;

export async function executar(argv: readonly string[], deps: Dependencias): Promise<SaidaCli> {
  const [comando, ...resto] = argv;
  let url = URL_PADRAO;
  const i = resto.indexOf('--url');
  if (i >= 0) {
    const valor = resto[i + 1];
    if (valor === undefined) return { codigo: 2, linhas: [USO] };
    url = valor;
    resto.splice(i, 2);
  }
  if ((comando !== 'baixar' && comando !== 'processar' && comando !== 'tudo') || resto.length > 0) {
    return { codigo: 2, linhas: [USO] };
  }

  const bruto = join(deps.raiz, 'data', 'raw', 'anvisa');
  const processado = join(deps.raiz, 'data', 'processed', 'anvisa');
  const rel = (caminho: string): string => relative(deps.raiz, caminho).split('\\').join('/');
  const linhas: string[] = [];

  try {
    let origem: string | undefined;
    if (comando === 'baixar' || comando === 'tudo') {
      const r = await baixar({
        destino: bruto,
        url,
        ...(deps.buscar === undefined ? {} : { buscar: deps.buscar }),
        ...(deps.agora === undefined ? {} : { agora: deps.agora }),
      });
      const { manifesto } = r;
      linhas.push(
        `${r.novo ? 'Baixado' : 'Já baixado (mesmo checksum)'}: ${manifesto.arquivo}, ${manifesto.bytes} bytes, versão ${manifesto.sha256.slice(0, 12)}, ${manifesto.baixadoEm}`,
        `  em ${rel(r.diretorio)}`,
      );
      origem = r.diretorio;
    }
    if (comando === 'processar' || comando === 'tudo') {
      const alvo = origem ?? ultimoDownload(bruto).diretorio;
      const r = processarDownload(alvo, processado);
      const { relatorio } = r.resultado;
      linhas.push(
        `Processado a versão ${relatorio.fonte.versao}: ${relatorio.linhasLidas} linhas, ${relatorio.registrosValidos} válidas, ${relatorio.rejeitados.total} rejeitadas (${relatorio.duplicados.exatas} duplicadas exatas)`,
        `  relatório: ${rel(join(r.diretorioSaida, 'relatorio-qualidade.md'))}`,
      );
    }
    return { codigo: 0, linhas };
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro);
    const tipo = erro instanceof ErroArquivo ? 'Erro' : 'Erro inesperado';
    return { codigo: 1, linhas: [...linhas, `${tipo}: ${motivo}`] };
  }
}

const entrada = process.argv[1];
if (entrada !== undefined && import.meta.url === pathToFileURL(entrada).href) {
  const raiz = fileURLToPath(new URL('../../../', import.meta.url));
  const saida = await executar(process.argv.slice(2), { raiz });
  console.log(saida.linhas.join('\n'));
  process.exit(saida.codigo);
}
