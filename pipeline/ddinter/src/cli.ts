import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  baixar,
  importar,
  ultimoDownload,
  URL_BASE_PADRAO,
  type ResultadoGuardar,
} from './baixar.js';
import { processarDownload } from './executar.js';
import { importarSite, ultimoSite } from './site.js';
import { processarSiteGuardado } from './saida-site.js';
import { COMANDOS_PARES, executarPares, USO_PARES } from './cli-pares.js';
import { ErroArquivo } from './processar.js';

export interface SaidaCli {
  /** 0 = ok, 1 = falha no download ou nos arquivos, 2 = uso incorreto. */
  codigo: 0 | 1 | 2;
  linhas: string[];
}

export interface Dependencias {
  /** Raiz do repositório; os caminhos de dados saem dela. */
  raiz: string;
  /** Pasta de onde `importar` e `tudo --pasta` leem; relativa ao diretório atual. */
  cwd?: string;
  buscar?: typeof fetch;
  agora?: () => Date;
  dormir?: (ms: number) => Promise<void>;
  aleatorio?: () => number;
  progresso?: (linha: string) => void;
}

const USO = `Uso: pipeline-ddinter <baixar | importar <pasta> | processar | tudo> [--base-url <endereço>] [--pasta <pasta>]

  baixar      baixa os 8 CSVs do DDInter para data/raw/ddinter/<versão>/ com manifesto e checksum
  importar    registra os 8 CSVs que você baixou à mão (nome ddinter_downloads_code_<letra>.csv) da <pasta>
  processar   lê o conjunto mais recente e gera interações, medicamentos, rejeições e relatório de
              qualidade em data/processed/ddinter/<versão>/
  tudo        baixar (ou importar, com --pasta <pasta>) + processar

Exportações do site (severity_*.csv, drug_food.csv, drug_disease.csv, therapeutic_duplication.csv):
  importar-site <pasta>   registra as 6 exportações em data/raw/ddinter-site/<versão>/
  processar-site          gera textos, alimentos, doenças, duplicidade e relatório em
                          data/processed/ddinter-site/<versão>/
  site <pasta>            importar-site + processar-site

${USO_PARES}`;

export async function executar(argv: readonly string[], deps: Dependencias): Promise<SaidaCli> {
  const [comando, ...argumentos] = argv;
  if ((COMANDOS_PARES as readonly string[]).includes(comando ?? ''))
    return executarPares(argv, deps);
  let baseUrl = URL_BASE_PADRAO;
  let pasta: string | undefined;
  const resto = [...argumentos];
  const tomar = (opcao: string): string | undefined | null => {
    const i = resto.indexOf(opcao);
    if (i < 0) return undefined;
    const valor = resto[i + 1];
    if (valor === undefined) return null;
    resto.splice(i, 2);
    return valor;
  };
  const b = tomar('--base-url');
  const p = tomar('--pasta');
  if (b === null || p === null) return { codigo: 2, linhas: [USO] };
  if (b !== undefined) baseUrl = b;
  if (p !== undefined) pasta = p;
  if (comando === 'importar-site' || comando === 'site') {
    const [posicional, ...sobra] = resto;
    if (posicional === undefined || sobra.length > 0 || pasta !== undefined) {
      return { codigo: 2, linhas: [USO] };
    }
    return executarSite(comando, posicional, deps);
  }
  if (comando === 'processar-site') {
    if (resto.length > 0 || pasta !== undefined) return { codigo: 2, linhas: [USO] };
    return executarSite(comando, undefined, deps);
  }
  if (comando === 'importar') {
    const [posicional, ...sobra] = resto;
    if (posicional === undefined || sobra.length > 0 || pasta !== undefined) {
      return { codigo: 2, linhas: [USO] };
    }
    pasta = posicional;
  } else if (
    (comando !== 'baixar' && comando !== 'processar' && comando !== 'tudo') ||
    resto.length > 0
  ) {
    return { codigo: 2, linhas: [USO] };
  }

  const bruto = join(deps.raiz, 'data', 'raw', 'ddinter');
  const processado = join(deps.raiz, 'data', 'processed', 'ddinter');
  const rel = (caminho: string): string => relative(deps.raiz, caminho).split('\\').join('/');
  const linhas: string[] = [];
  const descrever = (r: ResultadoGuardar, rotulo: string): void => {
    const { manifesto } = r;
    const bytes = manifesto.arquivos.reduce((s, a) => s + a.bytes, 0);
    linhas.push(
      `${r.novo ? rotulo : 'Já guardado (mesmo checksum)'}: ${manifesto.arquivos.length} arquivos, ${bytes} bytes, versão ${manifesto.sha256.slice(0, 12)}, ${manifesto.baixadoEm}`,
      `  em ${rel(r.diretorio)}`,
    );
  };

  try {
    let origem: string | undefined;
    const aoVivo = {
      ...(deps.agora === undefined ? {} : { agora: deps.agora }),
    };
    if (pasta !== undefined && (comando === 'importar' || comando === 'tudo')) {
      const caminho = isAbsolute(pasta) ? pasta : resolve(deps.cwd ?? process.cwd(), pasta);
      const r = importar({ destino: bruto, pasta: caminho, ...aoVivo });
      descrever(r, 'Importado');
      origem = r.diretorio;
    } else if (comando === 'baixar' || comando === 'tudo') {
      const r = await baixar({
        destino: bruto,
        baseUrl,
        ...(deps.buscar === undefined ? {} : { buscar: deps.buscar }),
        ...aoVivo,
      });
      descrever(r, 'Baixado');
      origem = r.diretorio;
    }
    if (comando === 'processar' || comando === 'tudo') {
      const alvo = origem ?? ultimoDownload(bruto).diretorio;
      const r = processarDownload(alvo, processado);
      const { relatorio } = r.resultado;
      linhas.push(
        `Processado o conjunto ${relatorio.fonte.versao}: ${relatorio.linhasLidas} linhas = ${relatorio.interacoesDistintas} interações distintas + ${relatorio.repetidas.total} repetidas + ${relatorio.rejeitados.total} rejeitadas (${relatorio.avisos.total} avisos; ${relatorio.farmacos.total} medicamentos)`,
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

function executarSite(
  comando: 'importar-site' | 'processar-site' | 'site',
  pasta: string | undefined,
  deps: Dependencias,
): SaidaCli {
  const bruto = join(deps.raiz, 'data', 'raw', 'ddinter-site');
  const processado = join(deps.raiz, 'data', 'processed', 'ddinter-site');
  const rel = (caminho: string): string => relative(deps.raiz, caminho).split('\\').join('/');
  const linhas: string[] = [];
  try {
    let origem: string | undefined;
    if (pasta !== undefined) {
      const caminho = isAbsolute(pasta) ? pasta : resolve(deps.cwd ?? process.cwd(), pasta);
      const r = importarSite({
        destino: bruto,
        pasta: caminho,
        ...(deps.agora === undefined ? {} : { agora: deps.agora }),
      });
      const bytes = r.manifesto.arquivos.reduce((s, a) => s + a.bytes, 0);
      linhas.push(
        `${r.novo ? 'Importado' : 'Já guardado (mesmo checksum)'}: ${r.manifesto.arquivos.length} arquivos, ${bytes} bytes, versão ${r.manifesto.sha256.slice(0, 12)}, ${r.manifesto.baixadoEm}`,
        `  em ${rel(r.diretorio)}`,
      );
      origem = r.diretorio;
    }
    if (comando !== 'importar-site') {
      const alvo = origem ?? ultimoSite(bruto).diretorio;
      const r = processarSiteGuardado(alvo, processado);
      const rp = r.resultado.relatorio;
      const lidas = rp.arquivos.reduce((s, a) => s + a.linhasLidas, 0);
      linhas.push(
        `Processado o conjunto ${rp.fonte.versao}: ${lidas} linhas lidas, ${rp.rejeitados.total} rejeitadas, ${rp.avisos.total} avisos`,
        `  ${rp.textosInteracao.total} textos de interação, ${rp.alimentos.total} alimentos, ${rp.doencas.total} doenças, ${rp.duplicidade.total} duplicidades`,
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
  const saida = await executar(process.argv.slice(2), {
    raiz,
    cwd: process.env['INIT_CWD'] ?? process.cwd(),
  });
  console.log(saida.linhas.join('\n'));
  process.exit(saida.codigo);
}
