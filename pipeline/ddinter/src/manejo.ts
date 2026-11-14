import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  caminhoProibido,
  ESPERA_BASE_MS,
  INTERVALO_PADRAO_MS,
  regrasRobots,
  TENTATIVAS,
  URL_SITE_PADRAO,
} from './coletor.js';
import { ErroArquivo } from './processar.js';
import { jsonl, pct, tabela } from './saida.js';

/**
 * Manejo, referências e alternativas, lidos da página de um par (`/server/interact/<idPar>/`).
 *
 * Interaction, Management e References valem para o **texto** (conferido à mão em dois pares do texto
 * 2404 e conferido de novo pelo próprio coletor numa amostra), então uma página por texto basta. As
 * alternativas são **por medicamento** (grupo ATC de 3º nível).
 */
export const FONTE_MANEJO_ID = 'ddinter-site-pagina-do-par';
export const AMOSTRA_PADRAO = 50;

export interface FarmacoAlternativo {
  id: string;
  nome: string;
}
export interface GrupoAlternativas {
  atc: string | null;
  farmacos: FarmacoAlternativo[];
}
export interface AlternativasDoFarmaco {
  /** Nome como a página mostra. */
  nome: string;
  /** Id do DDInter, na ordem da linha "ID" da página. */
  idFarmaco: string | null;
  grupos: GrupoAlternativas[];
  /** Lista completa guardada no script da página ("More"), quando a tabela mostra menos. */
  completo: FarmacoAlternativo[];
}
export interface PaginaPar {
  idsFarmacos: string[];
  nomes: string[];
  interacao: string | null;
  manejo: string | null;
  referencias: string[];
  alternativas: AlternativasDoFarmaco[];
}

const ENTIDADES: Record<string, string> = {
  quot: '"',
  amp: '&',
  lt: '<',
  gt: '>',
  apos: "'",
  nbsp: ' ',
};
const decodificar = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(Number(e.slice(1)));
    return ENTIDADES[e.toLowerCase()] ?? m;
  });
const limpar = (html: string): string =>
  decodificar(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

function celulaDe(html: string, chave: string): string | undefined {
  const m = new RegExp(
    `<td[^>]*class="key"[^>]*>\\s*${chave}\\s*</td>\\s*<td[^>]*>([\\s\\S]*?)</td>`,
  ).exec(html);
  return m?.[1];
}

/** Lê a página de um par. Falha, em vez de chutar, se a estrutura não for a conhecida. */
export function lerPaginaPar(html: string): PaginaPar {
  const interacaoHtml = celulaDe(html, 'Interaction');
  const manejoHtml = celulaDe(html, 'Management');
  const refsMatch = /<td[^>]*id="reference-text"[^>]*>([\s\S]*?)<\/td>/.exec(html);
  const idHtml = celulaDe(html, 'ID');
  if (
    interacaoHtml === undefined ||
    manejoHtml === undefined ||
    refsMatch === null ||
    idHtml === undefined
  ) {
    throw new ErroArquivo(
      'página fora do formato conhecido (faltam Interaction, Management, References ou ID)',
    );
  }
  const vazio = (s: string): string | null => (s === '' ? null : s);
  const referencias = [
    ...(refsMatch[1] as string).matchAll(/<span[^>]*class="d-block my-2"[^>]*>([\s\S]*?)<\/span>/g),
  ]
    .map((m) => limpar(m[1] as string).replace(/^\[\d+\]\s*/, ''))
    .filter((r) => r !== '');
  const idsFarmacos = [...idHtml.matchAll(/\/server\/drug-detail\/(DDInter\d+)\//g)].map(
    (m) => m[1] as string,
  );
  const nomes = [...html.matchAll(/<strong class="mx-2">([\s\S]*?)<\/strong>/g)]
    .slice(0, 2)
    .map((m) => limpar(m[1] as string));

  const alternativas: AlternativasDoFarmaco[] = [];
  const linhas = html.matchAll(
    /Alternative for\s*<span[^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/td>\s*<td[^>]*class="value"[^>]*>([\s\S]*?)<\/td>/g,
  );
  for (const [i, m] of [...linhas].entries()) {
    const grupos: GrupoAlternativas[] = [];
    let atual: GrupoAlternativas | null = null;
    for (const t of (m[2] as string).matchAll(
      /<span[^>]*class="badge[^"]*"[^>]*>\s*([A-Z]\d{2}[A-Z]?)\s*<\/span>|<a href="\/server\/drug-detail\/(DDInter\d+)\/"[^>]*>([\s\S]*?)<\/a>/g,
    )) {
      if (t[1] !== undefined) {
        atual = { atc: t[1], farmacos: [] };
        grupos.push(atual);
      } else {
        if (atual === null) {
          atual = { atc: null, farmacos: [] };
          grupos.push(atual);
        }
        atual.farmacos.push({ id: t[2] as string, nome: limpar(t[3] as string) });
      }
    }
    const lado = i === 0 ? 'a' : 'b';
    const completo = [
      ...html.matchAll(
        new RegExp(
          `all_candidate_${lado}_html \\+= '<a href="/server/drug-detail/(DDInter\\d+)/"[^>]*>([^<]*)</a>'`,
          'g',
        ),
      ),
    ].map((c) => ({ id: c[1] as string, nome: limpar(c[2] as string) }));
    alternativas.push({
      nome: limpar(m[1] as string),
      idFarmaco: idsFarmacos[i] ?? null,
      grupos,
      completo,
    });
  }
  return {
    idsFarmacos,
    nomes,
    interacao: vazio(limpar(interacaoHtml)),
    manejo: vazio(limpar(manejoHtml)),
    referencias,
    alternativas,
  };
}

/** Parte da página que interessa (do `<main` até o rodapé): é o que se guarda como bruto. */
export function recortarPagina(html: string): string {
  const ini = html.indexOf('<main');
  const fim = html.indexOf('<footer');
  if (ini < 0) throw new ErroArquivo('página sem <main>; o site mudou ou pediu verificação');
  return html.slice(ini, fim < 0 ? undefined : fim);
}

// ---------------------------------------------------------------------------------------------
// Coleta

export interface ItemFila {
  idPar: number;
  idTexto: number;
  papel: 'principal' | 'amostra';
}
export interface RespostaManejo extends ItemFila {
  /** 200, ou 404 quando o site diz que a página não existe. */
  status: number;
  coletadoEm: string;
  html: string;
}

export interface OpcoesColetarManejo {
  pasta: string;
  fila: readonly ItemFila[];
  baseUrl?: string;
  intervaloMs?: number;
  limite?: number;
  contato?: string;
  buscar?: typeof fetch;
  dormir?: (ms: number) => Promise<void>;
  agora?: () => Date;
  aleatorio?: () => number;
  progresso?: (linha: string) => void;
}
export interface ResultadoColetaManejo {
  feitos: number;
  jaFeitos: number;
  pendentes: number;
  paradaPor: 'concluida' | 'limite' | 'erro';
  motivo?: string;
}

const NOME_RESPOSTAS_MANEJO = 'respostas.jsonl';

export function lerFeitosManejo(pasta: string): Map<number, RespostaManejo> {
  const feitos = new Map<number, RespostaManejo>();
  const caminho = join(pasta, NOME_RESPOSTAS_MANEJO);
  if (!existsSync(caminho)) return feitos;
  for (const linha of readFileSync(caminho, 'utf8').split('\n')) {
    if (linha.trim() === '') continue;
    try {
      const r = JSON.parse(linha) as RespostaManejo;
      if (typeof r.idPar === 'number') feitos.set(r.idPar, r);
    } catch {
      // última linha cortada por uma interrupção: o par volta para a fila
    }
  }
  return feitos;
}

export async function coletarManejo(opcoes: OpcoesColetarManejo): Promise<ResultadoColetaManejo> {
  const base = (opcoes.baseUrl ?? URL_SITE_PADRAO).replace(/\/+$/, '');
  const buscar = opcoes.buscar ?? fetch;
  const dormir = opcoes.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const agora = opcoes.agora ?? (() => new Date());
  const aleatorio = opcoes.aleatorio ?? Math.random;
  const intervalo = opcoes.intervaloMs ?? INTERVALO_PADRAO_MS;
  const log = opcoes.progresso ?? (() => undefined);
  if (intervalo < 500) throw new ErroArquivo('intervalo mínimo entre pedidos: 500 ms');
  const userAgent = `doctorine-pipeline (projeto de estudo, uso nao comercial${opcoes.contato ? `; contato: ${opcoes.contato}` : ''})`;

  mkdirSync(opcoes.pasta, { recursive: true });
  const caminho = join(opcoes.pasta, NOME_RESPOSTAS_MANEJO);

  let robots: Response;
  try {
    robots = await buscar(`${base}/robots.txt`, { headers: { 'user-agent': userAgent } });
  } catch (erro) {
    const m = erro instanceof Error ? erro.message : String(erro);
    throw new ErroArquivo(`não foi possível acessar ${base}: ${m}`);
  }
  if (robots.ok && caminhoProibido('/server/interact/', regrasRobots(await robots.text()))) {
    throw new ErroArquivo(
      `o robots.txt de ${base} não permite acessar /server/interact/; coleta cancelada`,
    );
  }

  const feitos = lerFeitosManejo(opcoes.pasta);
  const pendentes = opcoes.fila.filter((i) => !feitos.has(i.idPar));
  const jaFeitos = opcoes.fila.length - pendentes.length;
  const alvo = opcoes.limite === undefined ? pendentes : pendentes.slice(0, opcoes.limite);
  if (alvo.length === 0) {
    return {
      feitos: 0,
      jaFeitos,
      pendentes: pendentes.length,
      paradaPor: pendentes.length === 0 ? 'concluida' : 'limite',
    };
  }
  if (existsSync(caminho)) {
    const t = readFileSync(caminho, 'utf8');
    if (t !== '' && !t.endsWith('\n')) appendFileSync(caminho, '\n');
  }

  const pedir = async (item: ItemFila): Promise<Response> => {
    for (let tentativa = 0; ; tentativa++) {
      let r: Response | undefined;
      let falha: string | undefined;
      try {
        r = await buscar(`${base}/server/interact/${item.idPar}/`, {
          headers: { 'user-agent': userAgent, accept: 'text/html' },
        });
      } catch (erro) {
        falha = erro instanceof Error ? erro.message : String(erro);
      }
      if (r !== undefined) {
        if (r.status === 403) {
          throw new ErroArquivo(
            `o site recusou o pedido (HTTP 403) no par ${item.idPar}; não vou insistir`,
          );
        }
        if (r.status !== 429 && r.status < 500) return r;
        falha = `HTTP ${r.status}`;
        const depois = Number(r.headers.get('retry-after'));
        if (Number.isFinite(depois) && depois > 0 && tentativa < TENTATIVAS) {
          log(`par ${item.idPar}: ${falha}; o site pediu para esperar ${depois}s`);
          await dormir(depois * 1000);
          continue;
        }
      }
      if (tentativa + 1 >= TENTATIVAS) {
        throw new ErroArquivo(
          `par ${item.idPar}: ${falha} depois de ${TENTATIVAS} tentativas; parei (o progresso está salvo)`,
        );
      }
      const espera = ESPERA_BASE_MS * 2 ** tentativa;
      log(`par ${item.idPar}: ${falha}; nova tentativa em ${Math.round(espera / 1000)}s`);
      await dormir(espera);
    }
  };

  let feitosAgora = 0;
  try {
    for (const [i, item] of alvo.entries()) {
      if (i > 0) await dormir(Math.round(intervalo * (1 + aleatorio() * 0.25)));
      const r = await pedir(item);
      let html = '';
      if (r.status !== 404) {
        if (!r.ok) throw new ErroArquivo(`par ${item.idPar}: HTTP ${r.status} inesperado; parei`);
        html = recortarPagina(await r.text());
        try {
          lerPaginaPar(html);
        } catch (erro) {
          const m = erro instanceof Error ? erro.message : String(erro);
          throw new ErroArquivo(`par ${item.idPar}: ${m}; parei`);
        }
      }
      const registro: RespostaManejo = {
        ...item,
        status: r.status === 404 ? 404 : 200,
        coletadoEm: agora().toISOString().slice(0, 10),
        html,
      };
      appendFileSync(caminho, JSON.stringify(registro) + '\n', 'utf8');
      feitosAgora++;
      if (feitosAgora % 100 === 0)
        log(`${feitosAgora} de ${alvo.length} páginas nesta execução (último par: ${item.idPar})`);
    }
  } catch (erro) {
    return {
      feitos: feitosAgora,
      jaFeitos,
      pendentes: pendentes.length - feitosAgora,
      paradaPor: 'erro',
      motivo: erro instanceof Error ? erro.message : String(erro),
    };
  }
  const restam = pendentes.length - feitosAgora;
  return {
    feitos: feitosAgora,
    jaFeitos,
    pendentes: restam,
    paradaPor: restam === 0 ? 'concluida' : 'limite',
  };
}

/**
 * Monta a fila a partir dos pares: um par por texto (o de menor id) e, em `amostra` textos com pelo
 * menos dois pares, um segundo par para conferir que o manejo é mesmo igual dentro do texto.
 */
export function montarFila(
  pares: ReadonlyArray<{ idPar: number; idTexto: number }>,
  amostra: number,
): ItemFila[] {
  const porTexto = new Map<number, number[]>();
  for (const p of pares) {
    const l = porTexto.get(p.idTexto);
    if (l === undefined) porTexto.set(p.idTexto, [p.idPar]);
    else l.push(p.idPar);
  }
  const textos = [...porTexto.keys()].sort((a, b) => a - b);
  const fila: ItemFila[] = [];
  for (const t of textos) {
    const ids = (porTexto.get(t) as number[]).sort((a, b) => a - b);
    fila.push({ idPar: ids[0] as number, idTexto: t, papel: 'principal' });
  }
  const comDois = textos.filter((t) => (porTexto.get(t) as number[]).length >= 2);
  const n = Math.min(amostra, comDois.length);
  for (let k = 0; k < n; k++) {
    const t = comDois[Math.floor((k * comDois.length) / n)] as number;
    const ids = porTexto.get(t) as number[];
    // segundo menor id, que não é o principal; em textos grandes o último, para variar a posição
    fila.push({
      idPar: k % 2 === 0 ? (ids[1] as number) : (ids[ids.length - 1] as number),
      idTexto: t,
      papel: 'amostra',
    });
  }
  return fila;
}

// ---------------------------------------------------------------------------------------------
// Fechar e processar

export interface ManifestoManejo {
  fonte: typeof FONTE_MANEJO_ID;
  origem: 'coleta';
  baixadoEm: string;
  sha256: string;
  bytes: number;
  baseUrl: string;
  paginas: number;
}

export interface FinalizadoManejo {
  diretorio: string;
  manifesto: ManifestoManejo;
  novo: boolean;
}

/** Exige toda a fila, grava as respostas ordenadas por par e o manifesto em `<destino>/<sha12>/`. */
export function finalizarManejo(opcoes: {
  pasta: string;
  destino: string;
  fila: readonly ItemFila[];
  baseUrl?: string;
}): FinalizadoManejo {
  const feitos = lerFeitosManejo(opcoes.pasta);
  const faltam = opcoes.fila.filter((i) => !feitos.has(i.idPar));
  if (faltam.length > 0) {
    throw new ErroArquivo(
      `a coleta está incompleta: faltam ${faltam.length} páginas (primeiros pares: ${faltam
        .slice(0, 5)
        .map((i) => i.idPar)
        .join(', ')}); rode "coletar-manejo" de novo`,
    );
  }
  const respostas = opcoes.fila
    .map((i) => feitos.get(i.idPar) as RespostaManejo)
    .sort((a, b) => a.idPar - b.idPar);
  const conteudo = jsonl(respostas);
  const sha = createHash('sha256').update(conteudo).digest('hex');
  const diretorio = join(opcoes.destino, sha.slice(0, 12));
  const manifestoCaminho = join(diretorio, 'manifesto.json');
  if (existsSync(manifestoCaminho)) {
    return {
      diretorio,
      manifesto: JSON.parse(readFileSync(manifestoCaminho, 'utf8')) as ManifestoManejo,
      novo: false,
    };
  }
  const manifesto: ManifestoManejo = {
    fonte: FONTE_MANEJO_ID,
    origem: 'coleta',
    baixadoEm: respostas.reduce((m, r) => (r.coletadoEm > m ? r.coletadoEm : m), ''),
    sha256: sha,
    bytes: Buffer.byteLength(conteudo),
    baseUrl: opcoes.baseUrl ?? URL_SITE_PADRAO,
    paginas: respostas.length,
  };
  mkdirSync(diretorio, { recursive: true });
  writeFileSync(join(diretorio, 'respostas-manejo.jsonl'), conteudo, 'utf8');
  writeFileSync(manifestoCaminho, JSON.stringify(manifesto, null, 2) + '\n', 'utf8');
  return { diretorio, manifesto, novo: true };
}

export interface ContextoManejo {
  /** id do texto → texto original da exportação do site, para conferir a "Interaction". */
  textoDaExportacao?: ReadonlyMap<number, string | null>;
  /** id do par → ids DDInter dos dois medicamentos, para conferir a página. */
  farmacosDoPar?: ReadonlyMap<number, readonly [string, string]>;
}

export interface TextoManejo {
  idTexto: number;
  idParLido: number;
  interacao: string | null;
  manejo: string | null;
  referencias: string[];
  proveniencia: {
    fonte: typeof FONTE_MANEJO_ID;
    url: string;
    versao: string;
    data: string;
  };
}
export interface AlternativasRegistro {
  idFarmaco: string;
  nome: string;
  grupos: GrupoAlternativas[];
  completo: FarmacoAlternativo[];
  vistoEmPares: number[];
}
export interface AvisoManejo {
  idTexto: number;
  idPar: number;
  tipo:
    | 'manejo-diverge-no-texto'
    | 'interacao-diferente-da-exportacao'
    | 'farmacos-diferentes-do-par'
    | 'alternativas-divergentes'
    | 'alternativas-incompletas-na-tabela'
    | 'pagina-nao-existe';
  detalhe: string;
}
export interface RejeicaoManejo {
  idTexto: number;
  idPar: number;
  motivo: string;
}
export interface RelatorioManejo {
  fonte: { id: string; sha256: string; versao: string; baixadoEm: string; baseUrl: string };
  paginas: { total: number; principais: number; amostras: number };
  rejeitados: { total: number; amostra: RejeicaoManejo[] };
  avisos: { total: number; porTipo: Record<string, number>; amostra: AvisoManejo[] };
  textos: {
    total: number;
    comManejo: number;
    semManejo: number;
    comReferencias: number;
    semReferencias: number;
    referenciasTotal: number;
  };
  verificacao: { comparadas: number; iguais: number; divergentes: number };
  alternativas: { farmacos: number; semAlternativas: number; divergentes: number };
}
export interface ResultadoManejo {
  textos: TextoManejo[];
  alternativas: AlternativasRegistro[];
  rejeicoes: RejeicaoManejo[];
  avisos: AvisoManejo[];
  relatorio: RelatorioManejo;
}

const normalizar = (s: string | null): string => (s ?? '').replace(/\s+/g, ' ').trim();
const chaveAlt = (r: { grupos: GrupoAlternativas[]; completo: FarmacoAlternativo[] }): string =>
  JSON.stringify([
    r.grupos.map((g) => [g.atc, g.farmacos.map((f) => f.id).sort()]).sort(),
    r.completo.map((f) => f.id).sort(),
  ]);

export function processarManejo(
  entrada: { bytes: Buffer; manifesto: ManifestoManejo },
  contexto: ContextoManejo = {},
): ResultadoManejo {
  const sha = createHash('sha256').update(entrada.bytes).digest('hex');
  if (sha !== entrada.manifesto.sha256) {
    throw new ErroArquivo('o arquivo não bate com o checksum do manifesto; foi alterado');
  }
  const versao = sha.slice(0, 12);
  const respostas = entrada.bytes
    .toString('utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as RespostaManejo);

  const textos: TextoManejo[] = [];
  const rejeicoes: RejeicaoManejo[] = [];
  const avisos: AvisoManejo[] = [];
  const alternativas = new Map<string, AlternativasRegistro>();
  const paginaDoPar = new Map<number, PaginaPar>();
  let divergentesAlt = 0;

  for (const r of respostas) {
    if (r.status === 404) {
      avisos.push({
        idTexto: r.idTexto,
        idPar: r.idPar,
        tipo: 'pagina-nao-existe',
        detalhe: 'o site respondeu 404 para a página do par',
      });
      continue;
    }
    let pagina: PaginaPar;
    try {
      pagina = lerPaginaPar(r.html);
    } catch (erro) {
      rejeicoes.push({
        idTexto: r.idTexto,
        idPar: r.idPar,
        motivo: erro instanceof Error ? erro.message : String(erro),
      });
      continue;
    }
    paginaDoPar.set(r.idPar, pagina);
    const esperados = contexto.farmacosDoPar?.get(r.idPar);
    if (
      esperados !== undefined &&
      [...esperados].sort().join('|') !== [...pagina.idsFarmacos].sort().join('|')
    ) {
      avisos.push({
        idTexto: r.idTexto,
        idPar: r.idPar,
        tipo: 'farmacos-diferentes-do-par',
        detalhe: `a página traz ${pagina.idsFarmacos.join(' e ')}, a lista de pares diz ${esperados.join(' e ')}`,
      });
    }
    for (const alt of pagina.alternativas) {
      if (alt.idFarmaco === null) continue;
      const atuais = new Set(alt.grupos.flatMap((g) => g.farmacos.map((f) => f.id)));
      if (alt.completo.some((f) => !atuais.has(f.id))) {
        avisos.push({
          idTexto: r.idTexto,
          idPar: r.idPar,
          tipo: 'alternativas-incompletas-na-tabela',
          detalhe: `${alt.idFarmaco}: a tabela mostra ${atuais.size} e o script da página, ${alt.completo.length}; vale o script`,
        });
      }
      const registro: AlternativasRegistro = {
        idFarmaco: alt.idFarmaco,
        nome: alt.nome,
        grupos: alt.grupos,
        completo: alt.completo,
        vistoEmPares: [r.idPar],
      };
      const anterior = alternativas.get(alt.idFarmaco);
      if (anterior === undefined) alternativas.set(alt.idFarmaco, registro);
      else {
        anterior.vistoEmPares.push(r.idPar);
        if (chaveAlt(anterior) !== chaveAlt(registro)) {
          divergentesAlt++;
          avisos.push({
            idTexto: r.idTexto,
            idPar: r.idPar,
            tipo: 'alternativas-divergentes',
            detalhe: `${alt.idFarmaco}: alternativas diferentes das lidas no par ${anterior.vistoEmPares[0]}; mantidas as primeiras`,
          });
        }
      }
    }
  }

  const principais = respostas.filter((r) => r.papel === 'principal' && paginaDoPar.has(r.idPar));
  for (const r of principais) {
    const p = paginaDoPar.get(r.idPar) as PaginaPar;
    const exportado = contexto.textoDaExportacao?.get(r.idTexto);
    if (exportado !== undefined && normalizar(exportado) !== normalizar(p.interacao)) {
      avisos.push({
        idTexto: r.idTexto,
        idPar: r.idPar,
        tipo: 'interacao-diferente-da-exportacao',
        detalhe: 'a "Interaction" da página não é igual ao texto da exportação do site',
      });
    }
    textos.push({
      idTexto: r.idTexto,
      idParLido: r.idPar,
      interacao: p.interacao,
      manejo: p.manejo,
      referencias: p.referencias,
      proveniencia: {
        fonte: FONTE_MANEJO_ID,
        url: `${entrada.manifesto.baseUrl}/server/interact/${r.idPar}/`,
        versao,
        data: r.coletadoEm,
      },
    });
  }
  textos.sort((a, b) => a.idTexto - b.idTexto);

  const porTexto = new Map(textos.map((t) => [t.idTexto, t]));
  let comparadas = 0;
  let iguais = 0;
  for (const r of respostas) {
    if (r.papel !== 'amostra') continue;
    const p = paginaDoPar.get(r.idPar);
    const base = porTexto.get(r.idTexto);
    if (p === undefined || base === undefined) continue;
    comparadas++;
    const difere = [
      normalizar(p.interacao) !== normalizar(base.interacao) ? 'Interaction' : null,
      normalizar(p.manejo) !== normalizar(base.manejo) ? 'Management' : null,
      p.referencias.map(normalizar).join('\n') !== base.referencias.map(normalizar).join('\n')
        ? 'References'
        : null,
    ].filter((x) => x !== null);
    if (difere.length === 0) iguais++;
    else {
      avisos.push({
        idTexto: r.idTexto,
        idPar: r.idPar,
        tipo: 'manejo-diverge-no-texto',
        detalhe: `${difere.join(', ')} do par ${r.idPar} diferem do par ${base.idParLido} do mesmo texto`,
      });
    }
  }

  const porTipo: Record<string, number> = {};
  for (const a of avisos) porTipo[a.tipo] = (porTipo[a.tipo] ?? 0) + 1;
  const listaAlt = [...alternativas.values()].sort((a, b) =>
    a.idFarmaco.localeCompare(b.idFarmaco, 'en', { numeric: true }),
  );
  const relatorio: RelatorioManejo = {
    fonte: {
      id: FONTE_MANEJO_ID,
      sha256: sha,
      versao,
      baixadoEm: entrada.manifesto.baixadoEm,
      baseUrl: entrada.manifesto.baseUrl,
    },
    paginas: {
      total: respostas.length,
      principais: respostas.filter((r) => r.papel === 'principal').length,
      amostras: respostas.filter((r) => r.papel === 'amostra').length,
    },
    rejeitados: { total: rejeicoes.length, amostra: rejeicoes.slice(0, 10) },
    avisos: { total: avisos.length, porTipo, amostra: avisos.slice(0, 10) },
    textos: {
      total: textos.length,
      comManejo: textos.filter((t) => t.manejo !== null).length,
      semManejo: textos.filter((t) => t.manejo === null).length,
      comReferencias: textos.filter((t) => t.referencias.length > 0).length,
      semReferencias: textos.filter((t) => t.referencias.length === 0).length,
      referenciasTotal: textos.reduce((s, t) => s + t.referencias.length, 0),
    },
    verificacao: { comparadas, iguais, divergentes: comparadas - iguais },
    alternativas: {
      farmacos: listaAlt.length,
      semAlternativas: listaAlt.filter((a) => a.grupos.every((g) => g.farmacos.length === 0))
        .length,
      divergentes: divergentesAlt,
    },
  };
  return { textos, alternativas: listaAlt, rejeicoes, avisos, relatorio };
}

export function relatorioManejoEmMarkdown(r: RelatorioManejo): string {
  const t = r.textos;
  const v = r.verificacao;
  return (
    [
      '# Relatório de qualidade: DDInter 2.0, manejo e referências (página do par)',
      tabela(
        ['Item', 'Valor'],
        [
          ['Versão (SHA-256, 12 primeiros)', `\`${r.fonte.versao}\``],
          ['SHA-256', `\`${r.fonte.sha256}\``],
          ['Coletado até', r.fonte.baixadoEm],
          ['Site', r.fonte.baseUrl],
        ],
      ),
      '## Páginas',
      tabela(
        ['Total', 'Principais (uma por texto)', 'Amostras de conferência'],
        [[r.paginas.total, r.paginas.principais, r.paginas.amostras]],
      ),
      '## Textos',
      tabela(
        ['Item', 'Valor'],
        [
          ['Textos com manejo', `${t.comManejo} (${pct(t.comManejo, t.total)})`],
          ['Textos sem manejo', t.semManejo],
          ['Textos com referências', `${t.comReferencias} (${pct(t.comReferencias, t.total)})`],
          ['Textos sem referências', t.semReferencias],
          ['Referências (total)', t.referenciasTotal],
        ],
      ),
      '## Conferência: o manejo é mesmo igual dentro do texto?',
      v.comparadas === 0
        ? 'Sem amostras para comparar.'
        : `${v.comparadas} segundos pares de textos com vários pares foram comparados com o par principal: ${v.iguais} iguais, ${v.divergentes} diferentes (Interaction, Management e References).`,
      '## Alternativas por medicamento',
      tabela(
        ['Medicamentos', 'Sem nenhuma alternativa', 'Alternativas divergentes entre páginas'],
        [[r.alternativas.farmacos, r.alternativas.semAlternativas, r.alternativas.divergentes]],
      ),
      '## Rejeições',
      r.rejeitados.total === 0
        ? 'Nenhuma página rejeitada.'
        : tabela(
            ['Texto', 'Par', 'Motivo'],
            r.rejeitados.amostra.map((x) => [x.idTexto, x.idPar, x.motivo]),
          ),
      '## Avisos',
      r.avisos.total === 0
        ? 'Nenhum aviso.'
        : [
            tabela(
              ['Tipo', 'Quantidade'],
              Object.entries(r.avisos.porTipo).map(([k, q]) => [k, q]),
            ),
            tabela(
              ['Texto', 'Par', 'Tipo', 'Detalhe'],
              r.avisos.amostra.map((a) => [a.idTexto, a.idPar, a.tipo, a.detalhe]),
            ),
          ].join('\n\n'),
    ].join('\n\n') + '\n'
  );
}

export function serializarManejo(res: ResultadoManejo): Record<string, string> {
  return {
    'textos-manejo.jsonl': jsonl(res.textos),
    'alternativas.jsonl': jsonl(res.alternativas),
    'rejeicoes.jsonl': jsonl(res.rejeicoes),
    'avisos.jsonl': jsonl(res.avisos),
    'relatorio-qualidade.json': JSON.stringify(res.relatorio, null, 2) + '\n',
    'relatorio-qualidade.md': relatorioManejoEmMarkdown(res.relatorio),
  };
}

export function processarManejoGuardado(
  diretorioBruto: string,
  saida: string,
  contexto: ContextoManejo = {},
) {
  const manifesto = JSON.parse(
    readFileSync(join(diretorioBruto, 'manifesto.json'), 'utf8'),
  ) as ManifestoManejo;
  const bytes = readFileSync(join(diretorioBruto, 'respostas-manejo.jsonl'));
  const resultado = processarManejo({ bytes, manifesto }, contexto);
  const diretorioSaida = join(saida, resultado.relatorio.fonte.versao);
  mkdirSync(diretorioSaida, { recursive: true });
  for (const [nome, t] of Object.entries(serializarManejo(resultado)))
    writeFileSync(join(diretorioSaida, nome), t, 'utf8');
  return { manifesto, diretorioSaida, resultado };
}

export { INTERVALO_PADRAO_MS };
