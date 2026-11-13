import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { coletar, INTERVALO_PADRAO_MS, URL_SITE_PADRAO, type OpcoesColetar } from './coletor.js';
import { finalizarColeta, processarParesGuardado, type ContextoPares } from './pares.js';
import { ErroArquivo } from './processar.js';
import { ultimoSite } from './site.js';
import { ultimoDownload } from './baixar.js';
import type { Nivel } from './schema.js';

export const COMANDOS_PARES = [
  'coletar-pares',
  'finalizar-pares',
  'processar-pares',
  'pares',
] as const;

export interface DependenciasPares {
  raiz: string;
  buscar?: typeof fetch;
  agora?: () => Date;
  dormir?: (ms: number) => Promise<void>;
  aleatorio?: () => number;
  /** Progresso ao vivo (a coleta leva horas). */
  progresso?: (linha: string) => void;
}

export interface SaidaPares {
  codigo: 0 | 1 | 2;
  linhas: string[];
}

export const USO_PARES = `Lista de pares por texto (coleta no site do DDInter 2.0; ver docs/fontes/ddinter.md):

  coletar-pares [--de N --ate M] [--intervalo ms] [--limite n] [--contato texto]
                [--base-url endereço] [--tamanho-pagina n] [--teste]
      pede ao site a lista de pares de cada texto de interação, um pedido por vez, com intervalo
      (padrão ${INTERVALO_PADRAO_MS} ms), respeitando o robots.txt e parando se o site recusar.
      Interromper e rodar de novo continua de onde parou. Sem --de/--ate usa a faixa de ids de
      data/processed/ddinter-site. --teste coleta só o texto 9 numa pasta à parte e mostra o resultado.
  finalizar-pares        exige todos os ids e grava data/raw/ddinter-pares/<versão>/
  processar-pares        lê o conjunto mais recente e gera pares, medicamentos e relatório em
                         data/processed/ddinter-pares/<versão>/
  pares                  finalizar-pares + processar-pares`;

const numeroOpcao = (v: string, nome: string): number => {
  if (!/^\d+$/.test(v))
    throw new ErroArquivo(`${nome} precisa ser um número inteiro, recebi "${v}"`);
  return Number(v);
};

function lerContexto(raiz: string): ContextoPares {
  const contexto: { nivelDoTexto?: Map<number, Nivel>; paresCsv?: Map<string, Nivel> } = {};
  try {
    const v = ultimoSite(join(raiz, 'data', 'raw', 'ddinter-site')).manifesto.sha256.slice(0, 12);
    const f = join(raiz, 'data', 'processed', 'ddinter-site', v, 'textos-interacao.jsonl');
    if (existsSync(f)) {
      const m = new Map<number, Nivel>();
      for (const l of readFileSync(f, 'utf8').split('\n')) {
        if (l === '') continue;
        const t = JSON.parse(l) as { id: number; nivel: Nivel };
        m.set(t.id, t.nivel);
      }
      contexto.nivelDoTexto = m;
    }
  } catch {
    // sem importação das exportações: a conferência é pulada
  }
  try {
    const v = ultimoDownload(join(raiz, 'data', 'raw', 'ddinter')).manifesto.sha256.slice(0, 12);
    const f = join(raiz, 'data', 'processed', 'ddinter', v, 'interacoes.jsonl');
    if (existsSync(f)) {
      const m = new Map<string, Nivel>();
      for (const l of readFileSync(f, 'utf8').split('\n')) {
        if (l === '') continue;
        const i = JSON.parse(l) as { idA: string; idB: string; nivel: Nivel };
        m.set(`${i.idA}|${i.idB}`, i.nivel);
      }
      contexto.paresCsv = m;
    }
  } catch {
    // sem os 8 CSVs processados: a conferência é pulada
  }
  return contexto;
}

/** Faixa de ids de texto, a partir das exportações já processadas. */
function faixaPadrao(raiz: string): { de: number; ate: number } {
  try {
    const v = ultimoSite(join(raiz, 'data', 'raw', 'ddinter-site')).manifesto.sha256.slice(0, 12);
    const rel = JSON.parse(
      readFileSync(
        join(raiz, 'data', 'processed', 'ddinter-site', v, 'relatorio-qualidade.json'),
        'utf8',
      ),
    ) as {
      textosInteracao: { idMinimo: number; idMaximo: number };
    };
    return { de: rel.textosInteracao.idMinimo, ate: rel.textosInteracao.idMaximo };
  } catch {
    throw new ErroArquivo(
      'não sei a faixa de ids: rode "site <pasta>" antes ou informe --de e --ate',
    );
  }
}

export async function executarPares(
  argv: readonly string[],
  deps: DependenciasPares,
): Promise<SaidaPares> {
  const [comando, ...resto] = argv;
  const opcoes = new Map<string, string>();
  let teste = false;
  for (let i = 0; i < resto.length; i++) {
    const a = resto[i] as string;
    if (a === '--teste') {
      teste = true;
    } else if (
      a.startsWith('--') &&
      resto[i + 1] !== undefined &&
      !(resto[i + 1] as string).startsWith('--')
    ) {
      opcoes.set(a, resto[++i] as string);
    } else {
      return { codigo: 2, linhas: [USO_PARES] };
    }
  }
  const permitidas =
    comando === 'coletar-pares'
      ? ['--de', '--ate', '--intervalo', '--limite', '--contato', '--base-url', '--tamanho-pagina']
      : [];
  if (
    [...opcoes.keys()].some((k) => !permitidas.includes(k)) ||
    (teste && comando !== 'coletar-pares')
  ) {
    return { codigo: 2, linhas: [USO_PARES] };
  }

  const bruto = join(deps.raiz, 'data', 'raw', 'ddinter-pares');
  const processado = join(deps.raiz, 'data', 'processed', 'ddinter-pares');
  const rel = (c: string): string => relative(deps.raiz, c).split('\\').join('/');
  const linhas: string[] = [];
  try {
    if (comando === 'coletar-pares') {
      const faixa = teste
        ? { de: 9, ate: 9 }
        : opcoes.has('--de') && opcoes.has('--ate')
          ? {
              de: numeroOpcao(opcoes.get('--de') as string, '--de'),
              ate: numeroOpcao(opcoes.get('--ate') as string, '--ate'),
            }
          : faixaPadrao(deps.raiz);
      const pasta = join(bruto, teste ? '_coleta-teste' : '_coleta');
      const o: OpcoesColetar = {
        pasta,
        de: faixa.de,
        ate: faixa.ate,
        baseUrl: opcoes.get('--base-url') ?? URL_SITE_PADRAO,
        ...(opcoes.has('--intervalo')
          ? { intervaloMs: numeroOpcao(opcoes.get('--intervalo') as string, '--intervalo') }
          : {}),
        ...(opcoes.has('--limite')
          ? { limite: numeroOpcao(opcoes.get('--limite') as string, '--limite') }
          : {}),
        ...(opcoes.has('--tamanho-pagina')
          ? {
              tamanhoPagina: numeroOpcao(
                opcoes.get('--tamanho-pagina') as string,
                '--tamanho-pagina',
              ),
            }
          : {}),
        ...(opcoes.has('--contato') ? { contato: opcoes.get('--contato') as string } : {}),
        ...(deps.buscar === undefined ? {} : { buscar: deps.buscar }),
        ...(deps.agora === undefined ? {} : { agora: deps.agora }),
        ...(deps.dormir === undefined ? {} : { dormir: deps.dormir }),
        ...(deps.aleatorio === undefined ? {} : { aleatorio: deps.aleatorio }),
        ...(deps.progresso === undefined ? {} : { progresso: deps.progresso }),
      };
      const r = await coletar(o);
      linhas.push(
        `Coleta de ${faixa.de} a ${faixa.ate}: ${r.feitos} ids pedidos agora, ${r.jaFeitos} já estavam feitos, ${r.pendentes} pendentes (${r.paradaPor})`,
        `  em ${rel(pasta)}`,
      );
      if (r.motivo !== undefined) {
        linhas.push(`Erro: ${r.motivo}`);
        return { codigo: 1, linhas };
      }
      if (teste) {
        const primeira = readFileSync(join(pasta, 'respostas.jsonl'), 'utf8').split('\n')[0] ?? '';
        linhas.push(
          `Resposta do texto 9 (esperado: 1 par, Moexipril + Sacubitril): ${primeira.slice(0, 600)}`,
        );
      } else if (r.paradaPor === 'concluida') {
        linhas.push(
          'Coleta completa. Próximo passo: pnpm --filter @doctorine/pipeline-ddinter pares',
        );
      }
      return { codigo: 0, linhas };
    }

    let diretorio: string | undefined;
    if (comando === 'finalizar-pares' || comando === 'pares') {
      const r = finalizarColeta({ pasta: join(bruto, '_coleta'), destino: bruto });
      const m = r.manifesto.idsPedidos;
      linhas.push(
        `${r.novo ? 'Finalizado' : 'Já finalizado (mesmo checksum)'}: ${m.total} ids de texto (${m.comPares} com pares, ${m.semPares} sem, ${m.naoEncontrados} não encontrados), versão ${r.manifesto.sha256.slice(0, 12)}`,
        `  em ${rel(r.diretorio)}`,
      );
      diretorio = r.diretorio;
    }
    if (comando === 'processar-pares' || comando === 'pares') {
      if (diretorio === undefined) diretorio = ultimaFinalizada(bruto);
      const r = processarParesGuardado(diretorio, processado, lerContexto(deps.raiz));
      const rp = r.resultado.relatorio;
      linhas.push(
        `Processado o conjunto ${rp.fonte.versao}: ${rp.linhas} linhas = ${rp.pares.registros} registros + ${rp.rejeitados.total} rejeitadas (${rp.avisos.total} avisos; ${rp.pares.paresDeMedicamentos} pares de medicamentos, ${rp.farmacos.total} medicamentos)`,
        `  relatório: ${rel(join(r.diretorioSaida, 'relatorio-qualidade.md'))}`,
      );
    }
    return { codigo: 0, linhas };
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro);
    return {
      codigo: 1,
      linhas: [...linhas, `${erro instanceof ErroArquivo ? 'Erro' : 'Erro inesperado'}: ${motivo}`],
    };
  }
}

function ultimaFinalizada(bruto: string): string {
  const itens = existsSync(bruto)
    ? readdirSync(bruto, { withFileTypes: true })
        .filter(
          (e) =>
            e.isDirectory() &&
            !e.name.startsWith('_') &&
            existsSync(join(bruto, e.name, 'manifesto.json')),
        )
        .map((e) => ({
          dir: join(bruto, e.name),
          m: JSON.parse(readFileSync(join(bruto, e.name, 'manifesto.json'), 'utf8')) as {
            baixadoEm: string;
            sha256: string;
          },
        }))
    : [];
  itens.sort(
    (a, b) =>
      (a.m.baixadoEm < b.m.baixadoEm ? 1 : a.m.baixadoEm > b.m.baixadoEm ? -1 : 0) ||
      (a.m.sha256 < b.m.sha256 ? 1 : -1),
  );
  const [melhor] = itens;
  if (melhor === undefined)
    throw new ErroArquivo(`nenhuma coleta finalizada em ${bruto}; rode "finalizar-pares" antes`);
  return melhor.dir;
}
