import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ErroArquivo, FONTE_ID, versaoDoConjunto } from './processar.js';
import { LETRAS_ESPERADAS, letraDoArquivo, nomeArquivo } from './schema.js';

/**
 * Endereço dos downloads do DDInter 2.0. NÃO CONFIRMADO: o site não era acessível quando o
 * pipeline foi escrito (os arquivos de 2026-11-12 vieram baixados à mão). O endereço do DDInter 1.0
 * era `http://ddinter.scbdd.com/static/media/download/`. Use `--base-url` se for outro.
 */
export const URL_BASE_PADRAO = 'https://ddinter2.scbdd.com/static/media/download';
export const NOME_MANIFESTO = 'manifesto.json';

export interface ManifestoArquivo {
  letra: string;
  arquivo: string;
  /** null quando o arquivo foi importado de uma pasta local. */
  url: string | null;
  sha256: string;
  bytes: number;
  ultimaModificacao: string | null;
  etag: string | null;
}

/** Registro de um conjunto de arquivos: de onde veio, quando, e o checksum que o identifica. */
export interface Manifesto {
  fonte: string;
  origem: 'download' | 'manual';
  /** AAAA-MM-DD (UTC). */
  baixadoEm: string;
  /** SHA-256 do conjunto (ver `versaoDoConjunto`). */
  sha256: string;
  arquivos: ManifestoArquivo[];
}

export interface ResultadoGuardar {
  diretorio: string;
  manifesto: Manifesto;
  /** false quando já existia um conjunto com o mesmo conteúdo (nada foi regravado). */
  novo: boolean;
}

interface ArquivoBruto {
  letra: string;
  bytes: Uint8Array;
  url: string | null;
  ultimaModificacao: string | null;
  etag: string | null;
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/**
 * Guarda o conjunto em `<destino>/<sha12>/`, com o manifesto escrito por último (pasta sem
 * manifesto é download incompleto). A pasta é nomeada pelo conteúdo: guardar o mesmo conjunto de
 * novo não muda nada. Exige as 8 letras: conjunto incompleto não vira versão.
 */
function guardar(
  destino: string,
  arquivos: ArquivoBruto[],
  origem: Manifesto['origem'],
  baixadoEm: string,
): ResultadoGuardar {
  const letras = arquivos.map((a) => a.letra);
  const faltam = LETRAS_ESPERADAS.filter((l) => !letras.includes(l));
  const sobram = letras.filter((l) => !(LETRAS_ESPERADAS as readonly string[]).includes(l));
  const repetidas = letras.filter((l, i) => letras.indexOf(l) !== i);
  if (faltam.length > 0 || sobram.length > 0 || repetidas.length > 0) {
    throw new ErroArquivo(
      `conjunto incompleto: faltam [${faltam.join(', ')}], inesperados [${sobram.join(', ')}], repetidos [${repetidas.join(', ')}]`,
    );
  }
  const ordenados = [...arquivos].sort((a, b) => (a.letra < b.letra ? -1 : 1));
  const itens: ManifestoArquivo[] = ordenados.map((a) => ({
    letra: a.letra,
    arquivo: nomeArquivo(a.letra),
    url: a.url,
    sha256: sha256(a.bytes),
    bytes: a.bytes.byteLength,
    ultimaModificacao: a.ultimaModificacao,
    etag: a.etag,
  }));
  const conjunto = versaoDoConjunto(itens);
  const diretorio = join(destino, conjunto.versao);
  if (existsSync(join(diretorio, NOME_MANIFESTO))) {
    return { diretorio, manifesto: lerManifesto(diretorio), novo: false };
  }
  const manifesto: Manifesto = {
    fonte: FONTE_ID,
    origem,
    baixadoEm,
    sha256: conjunto.sha256,
    arquivos: itens,
  };
  mkdirSync(diretorio, { recursive: true });
  for (const a of ordenados) writeFileSync(join(diretorio, nomeArquivo(a.letra)), a.bytes);
  writeFileSync(join(diretorio, NOME_MANIFESTO), JSON.stringify(manifesto, null, 2) + '\n', 'utf8');
  return { diretorio, manifesto, novo: true };
}

export interface OpcoesBaixar {
  destino: string;
  baseUrl?: string;
  buscar?: typeof fetch;
  agora?: () => Date;
}

const dataIso = (d: Date): string => d.toISOString().slice(0, 10);

/** Baixa os 8 arquivos. Se qualquer um falhar, nada é gravado. */
export async function baixar(opcoes: OpcoesBaixar): Promise<ResultadoGuardar> {
  const base = (opcoes.baseUrl ?? URL_BASE_PADRAO).replace(/\/+$/, '');
  const buscar = opcoes.buscar ?? fetch;
  const agora = opcoes.agora ?? (() => new Date());
  const arquivos: ArquivoBruto[] = [];
  for (const letra of LETRAS_ESPERADAS) {
    const url = `${base}/${nomeArquivo(letra)}`;
    let resposta: Response;
    try {
      resposta = await buscar(url, {
        headers: { 'user-agent': 'doctorine-pipeline (projeto de estudo)' },
      });
    } catch (erro) {
      const causa = erro instanceof Error ? erro.cause : undefined;
      const detalhe =
        causa instanceof Error
          ? causa.message
          : erro instanceof Error
            ? erro.message
            : String(erro);
      throw new ErroArquivo(
        `não foi possível acessar ${url}: ${detalhe}. Se o site estiver fora do ar, baixe os arquivos à mão e use "importar <pasta>"`,
      );
    }
    if (!resposta.ok) throw new ErroArquivo(`download falhou: HTTP ${resposta.status} em ${url}`);
    const bytes = new Uint8Array(await resposta.arrayBuffer());
    if (bytes.byteLength === 0) throw new ErroArquivo(`download vazio em ${url}`);
    if (new TextDecoder('latin1').decode(bytes.subarray(0, 64)).trimStart().startsWith('<')) {
      throw new ErroArquivo(`o endereço devolveu uma página HTML, não o CSV: ${url}`);
    }
    arquivos.push({
      letra,
      bytes,
      url,
      ultimaModificacao: resposta.headers.get('last-modified'),
      etag: resposta.headers.get('etag'),
    });
  }
  return guardar(opcoes.destino, arquivos, 'download', dataIso(agora()));
}

export interface OpcoesImportar {
  destino: string;
  /** Pasta com os CSVs baixados à mão. Prefixos no nome do arquivo são aceitos. */
  pasta: string;
  agora?: () => Date;
}

/** Registra no pipeline arquivos que o Edu baixou do site; o manifesto marca a origem como "manual". */
export function importar(opcoes: OpcoesImportar): ResultadoGuardar {
  const agora = opcoes.agora ?? (() => new Date());
  if (!existsSync(opcoes.pasta)) throw new ErroArquivo(`pasta não encontrada: ${opcoes.pasta}`);
  const arquivos: ArquivoBruto[] = [];
  for (const nome of readdirSync(opcoes.pasta).sort()) {
    const letra = letraDoArquivo(nome);
    if (letra === null) continue;
    arquivos.push({
      letra,
      bytes: readFileSync(join(opcoes.pasta, nome)),
      url: null,
      ultimaModificacao: null,
      etag: null,
    });
  }
  if (arquivos.length === 0) {
    throw new ErroArquivo(`nenhum arquivo ddinter_downloads_code_*.csv em ${opcoes.pasta}`);
  }
  return guardar(opcoes.destino, arquivos, 'manual', dataIso(agora()));
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

/** O conjunto mais recente: maior data; em empate de data, o maior SHA-256 (ordem estável). */
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
  if (melhor === undefined) {
    throw new ErroArquivo(
      `nenhum download encontrado em ${raiz}; rode "baixar" ou "importar" antes`,
    );
  }
  return melhor;
}
