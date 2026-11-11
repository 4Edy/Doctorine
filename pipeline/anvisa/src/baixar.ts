import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ErroArquivo, FONTE_ID } from './processar.js';

export const URL_PADRAO = 'https://dados.anvisa.gov.br/dados/DADOS_ABERTOS_MEDICAMENTOS.csv';
export const NOME_MANIFESTO = 'manifesto.json';

/** Registro de um download: de onde veio, quando, e o checksum que o identifica. */
export interface Manifesto {
  fonte: string;
  arquivo: string;
  url: string;
  /** AAAA-MM-DD (UTC). */
  baixadoEm: string;
  sha256: string;
  bytes: number;
  /** Cabeçalhos do servidor, quando existem. */
  ultimaModificacao: string | null;
  etag: string | null;
}

export interface OpcoesBaixar {
  /** Pasta onde ficam os downloads (uma subpasta por versão). */
  destino: string;
  url?: string;
  buscar?: typeof fetch;
  agora?: () => Date;
}

export interface ResultadoBaixar {
  diretorio: string;
  manifesto: Manifesto;
  /** false quando já existia um download com o mesmo conteúdo (nada foi regravado). */
  novo: boolean;
}

const sha12 = (sha256: string): string => sha256.slice(0, 12);

/**
 * Baixa o arquivo e o guarda em `<destino>/<sha12>/`, junto com o manifesto. A pasta é nomeada
 * pelo conteúdo: baixar duas vezes o mesmo arquivo não cria nada novo e não muda o manifesto
 * original. O manifesto é escrito por último, então pasta sem manifesto é download incompleto.
 */
export async function baixar(opcoes: OpcoesBaixar): Promise<ResultadoBaixar> {
  const url = opcoes.url ?? URL_PADRAO;
  const buscar = opcoes.buscar ?? fetch;
  const agora = opcoes.agora ?? (() => new Date());

  let resposta: Response;
  try {
    resposta = await buscar(url, {
      headers: { 'user-agent': 'doctorine-pipeline (projeto de estudo)' },
    });
  } catch (erro) {
    const causa = erro instanceof Error ? erro.cause : undefined;
    const detalhe =
      causa instanceof Error ? causa.message : erro instanceof Error ? erro.message : String(erro);
    throw new ErroArquivo(`não foi possível acessar ${url}: ${detalhe}`);
  }
  if (!resposta.ok) throw new ErroArquivo(`download falhou: HTTP ${resposta.status} em ${url}`);
  const bytes = new Uint8Array(await resposta.arrayBuffer());
  if (bytes.byteLength === 0) throw new ErroArquivo(`download vazio em ${url}`);
  if (new TextDecoder('latin1').decode(bytes.subarray(0, 64)).trimStart().startsWith('<')) {
    throw new ErroArquivo(`o endereço devolveu uma página HTML, não o CSV: ${url}`);
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const diretorio = join(opcoes.destino, sha12(sha256));
  const caminhoManifesto = join(diretorio, NOME_MANIFESTO);
  if (existsSync(caminhoManifesto)) {
    return { diretorio, manifesto: lerManifesto(diretorio), novo: false };
  }

  const arquivo = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? 'arquivo.csv');
  const manifesto: Manifesto = {
    fonte: FONTE_ID,
    arquivo,
    url,
    baixadoEm: agora().toISOString().slice(0, 10),
    sha256,
    bytes: bytes.byteLength,
    ultimaModificacao: resposta.headers.get('last-modified'),
    etag: resposta.headers.get('etag'),
  };
  mkdirSync(diretorio, { recursive: true });
  writeFileSync(join(diretorio, arquivo), bytes);
  writeFileSync(caminhoManifesto, JSON.stringify(manifesto, null, 2) + '\n', 'utf8');
  return { diretorio, manifesto, novo: true };
}

export function lerManifesto(diretorio: string): Manifesto {
  const caminho = join(diretorio, NOME_MANIFESTO);
  try {
    return JSON.parse(readFileSync(caminho, 'utf8')) as Manifesto;
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro);
    throw new ErroArquivo(`manifesto ilegível em ${caminho}: ${motivo}`);
  }
}

/** O download mais recente: maior data; em empate de data, o maior SHA-256 (ordem estável). */
export function ultimoDownload(raiz: string): { diretorio: string; manifesto: Manifesto } {
  const candidatos = existsSync(raiz)
    ? readdirSync(raiz, { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(join(raiz, e.name, NOME_MANIFESTO)))
        .map((e) => ({
          diretorio: join(raiz, e.name),
          manifesto: lerManifesto(join(raiz, e.name)),
        }))
    : [];
  candidatos.sort(
    (a, b) =>
      (a.manifesto.baixadoEm < b.manifesto.baixadoEm
        ? 1
        : a.manifesto.baixadoEm > b.manifesto.baixadoEm
          ? -1
          : 0) || (a.manifesto.sha256 < b.manifesto.sha256 ? 1 : -1),
  );
  const [melhor] = candidatos;
  if (melhor === undefined)
    throw new ErroArquivo(`nenhum download encontrado em ${raiz}; rode "baixar" antes`);
  return melhor;
}
