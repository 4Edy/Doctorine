import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ErroArquivo } from './processar.js';

/**
 * Coletor da lista de pares do site do DDInter 2.0: para cada id de texto de interação, pede a
 * lista de pares a que o texto se aplica (`POST /server/inter-list/<id>/`, o mesmo pedido que a
 * página `/server/inter-detail/<id>/` faz no navegador).
 *
 * Feito para não incomodar o site: um pedido por vez, intervalo fixo entre pedidos, recuo
 * exponencial em 429 e 5xx, respeito ao robots.txt, e parada (sem insistir) se o site recusar.
 * O progresso é gravado a cada id; interromper e rodar de novo continua de onde parou.
 */
export const URL_SITE_PADRAO = 'https://ddinter2.scbdd.com';
export const INTERVALO_PADRAO_MS = 1500;
export const TAMANHO_PAGINA_PADRAO = 100;
const TENTATIVAS = 5;
const ESPERA_BASE_MS = 30_000;
const MAX_PAGINAS_POR_ID = 1000;
export const NOME_RESPOSTAS = 'respostas.jsonl';
export const NOME_CONFIG = 'config.json';

export interface OpcoesColetar {
  /** Pasta de trabalho da coleta (`data/raw/ddinter-pares/_coleta`). */
  pasta: string;
  de: number;
  ate: number;
  baseUrl?: string;
  intervaloMs?: number;
  /** Máximo de ids pedidos nesta execução (para testar ou dividir em partes). */
  limite?: number;
  tamanhoPagina?: number;
  /** Texto livre (por exemplo, um e-mail) que identifica quem coleta, no User-Agent. */
  contato?: string;
  buscar?: typeof fetch;
  dormir?: (ms: number) => Promise<void>;
  agora?: () => Date;
  aleatorio?: () => number;
  progresso?: (linha: string) => void;
}

export type ParadaPor = 'concluida' | 'limite' | 'erro';

export interface ResultadoColeta {
  /** Ids pedidos nesta execução. */
  feitos: number;
  /** Ids que já estavam feitos de execuções anteriores (dentro do intervalo). */
  jaFeitos: number;
  pendentes: number;
  paradaPor: ParadaPor;
  motivo?: string;
}

export interface RespostaColetada {
  idTexto: number;
  /** 200, ou 404 quando o site diz que o texto não existe. */
  status: number;
  total: number;
  paginas: number;
  /** AAAA-MM-DD (UTC). */
  coletadoEm: string;
  /** Linhas como o site devolveu, sem alteração. */
  linhas: unknown[];
}

const dormirPadrao = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Disallow do grupo "*" do robots.txt (leitura mínima: não trata curingas além de prefixo). */
export function regrasRobots(texto: string): string[] {
  const proibidos: string[] = [];
  let emGrupoGeral = false;
  let viuRegra = false;
  for (const bruta of texto.split(/\r?\n/)) {
    const linha = bruta.replace(/#.*/, '').trim();
    if (linha === '') continue;
    const i = linha.indexOf(':');
    if (i < 0) continue;
    const campo = linha.slice(0, i).trim().toLowerCase();
    const valor = linha.slice(i + 1).trim();
    if (campo === 'user-agent') {
      if (viuRegra) {
        emGrupoGeral = false;
        viuRegra = false;
      }
      emGrupoGeral = emGrupoGeral || valor === '*';
    } else if (campo === 'disallow' || campo === 'allow') {
      viuRegra = true;
      if (emGrupoGeral && campo === 'disallow' && valor !== '') proibidos.push(valor);
    }
  }
  return proibidos;
}

export const caminhoProibido = (caminho: string, proibidos: readonly string[]): boolean =>
  proibidos.some((p) => caminho.startsWith(p));

class Sessao {
  private cookies = new Map<string, string>();
  token = '';
  constructor(
    private readonly base: string,
    private readonly buscar: typeof fetch,
    private readonly userAgent: string,
  ) {}

  cabecalhoCookie(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  /** Abre a página do texto como o navegador: guarda o cookie e o token CSRF. */
  async iniciar(idTexto: number): Promise<void> {
    const url = `${this.base}/server/inter-detail/${idTexto}/`;
    const r = await this.buscar(url, {
      headers: { 'user-agent': this.userAgent, accept: 'text/html' },
    });
    if (!r.ok) throw new ErroArquivo(`não consegui abrir ${url}: HTTP ${r.status}`);
    this.cookies.clear();
    for (const linha of r.headers.getSetCookie()) {
      const par = linha.split(';')[0] ?? '';
      const i = par.indexOf('=');
      if (i > 0) this.cookies.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
    }
    const html = await r.text();
    const m =
      /name=["']csrfmiddlewaretoken["'][^>]*value=["']([^"']+)["']/.exec(html) ??
      /value=["']([^"']+)["'][^>]*name=["']csrfmiddlewaretoken["']/.exec(html);
    this.token = m?.[1] ?? this.cookies.get('csrftoken') ?? '';
    if (this.token === '') {
      throw new ErroArquivo(
        `a página ${url} não trouxe token CSRF nem cookie csrftoken; o site mudou?`,
      );
    }
  }

  corpo(inicio: number, tamanho: number): string {
    const p = new URLSearchParams();
    p.set('csrfmiddlewaretoken', this.token);
    p.set('draw', '1');
    const dados = ['null', 'level', 'null', 'null'];
    dados.forEach((d, i) => {
      p.set(`columns[${i}][data]`, d);
      p.set(`columns[${i}][name]`, '');
      p.set(`columns[${i}][searchable]`, 'true');
      p.set(`columns[${i}][orderable]`, 'false');
      p.set(`columns[${i}][search][value]`, '');
      p.set(`columns[${i}][search][regex]`, 'false');
    });
    p.set('start', String(inicio));
    p.set('length', String(tamanho));
    p.set('search[value]', '');
    p.set('search[regex]', 'false');
    return p.toString();
  }

  pedir(idTexto: number, inicio: number, tamanho: number): Promise<Response> {
    return this.buscar(`${this.base}/server/inter-list/${idTexto}/`, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/javascript, */*; q=0.01',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        origin: this.base,
        referer: `${this.base}/server/inter-detail/${idTexto}/`,
        'x-requested-with': 'XMLHttpRequest',
        'x-csrftoken': this.token,
        cookie: this.cabecalhoCookie(),
        'user-agent': this.userAgent,
      },
      body: this.corpo(inicio, tamanho),
    });
  }
}

interface PaginaSite {
  recordsFiltered: number;
  data: unknown[];
}

function lerPagina(json: unknown): PaginaSite {
  const o = json as { recordsFiltered?: unknown; recordsTotal?: unknown; data?: unknown };
  const total = typeof o?.recordsFiltered === 'number' ? o.recordsFiltered : o?.recordsTotal;
  if (typeof total !== 'number' || !Array.isArray(o?.data)) {
    throw new ErroArquivo(
      'resposta do site fora do formato esperado (faltam recordsFiltered e data)',
    );
  }
  return { recordsFiltered: total, data: o.data };
}

export function lerFeitos(pasta: string): Map<number, RespostaColetada> {
  const caminho = join(pasta, NOME_RESPOSTAS);
  const feitos = new Map<number, RespostaColetada>();
  if (!existsSync(caminho)) return feitos;
  for (const linha of readFileSync(caminho, 'utf8').split('\n')) {
    if (linha.trim() === '') continue;
    try {
      const r = JSON.parse(linha) as RespostaColetada;
      if (typeof r.idTexto === 'number') feitos.set(r.idTexto, r);
    } catch {
      // última linha cortada por uma interrupção: o id volta para a fila
    }
  }
  return feitos;
}

export async function coletar(opcoes: OpcoesColetar): Promise<ResultadoColeta> {
  const base = (opcoes.baseUrl ?? URL_SITE_PADRAO).replace(/\/+$/, '');
  const buscar = opcoes.buscar ?? fetch;
  const dormir = opcoes.dormir ?? dormirPadrao;
  const agora = opcoes.agora ?? (() => new Date());
  const aleatorio = opcoes.aleatorio ?? Math.random;
  const intervalo = opcoes.intervaloMs ?? INTERVALO_PADRAO_MS;
  const tamanho = opcoes.tamanhoPagina ?? TAMANHO_PAGINA_PADRAO;
  const log = opcoes.progresso ?? (() => undefined);
  const userAgent = `doctorine-pipeline (projeto de estudo, uso nao comercial${opcoes.contato ? `; contato: ${opcoes.contato}` : ''})`;
  if (
    !Number.isInteger(opcoes.de) ||
    !Number.isInteger(opcoes.ate) ||
    opcoes.de < 0 ||
    opcoes.ate < opcoes.de
  ) {
    throw new ErroArquivo(`intervalo de ids inválido: ${opcoes.de} a ${opcoes.ate}`);
  }
  if (intervalo < 500) throw new ErroArquivo('intervalo mínimo entre pedidos: 500 ms');
  if (tamanho < 1 || tamanho > 1000) throw new ErroArquivo('tamanho de página fora de 1 a 1000');

  mkdirSync(opcoes.pasta, { recursive: true });
  const caminhoRespostas = join(opcoes.pasta, NOME_RESPOSTAS);
  writeFileSync(
    join(opcoes.pasta, NOME_CONFIG),
    JSON.stringify(
      {
        baseUrl: base,
        de: opcoes.de,
        ate: opcoes.ate,
        userAgent,
        intervaloMs: intervalo,
        tamanhoPagina: tamanho,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  // 1. robots.txt: se o site pede para não acessar /server/, a coleta não começa.
  let robots: Response;
  try {
    robots = await buscar(`${base}/robots.txt`, { headers: { 'user-agent': userAgent } });
  } catch (erro) {
    const m = erro instanceof Error ? erro.message : String(erro);
    throw new ErroArquivo(`não foi possível acessar ${base}: ${m}`);
  }
  if (robots.ok) {
    const proibidos = regrasRobots(await robots.text());
    for (const caminho of ['/server/inter-list/', '/server/inter-detail/']) {
      if (caminhoProibido(caminho, proibidos)) {
        throw new ErroArquivo(
          `o robots.txt de ${base} não permite acessar ${caminho}; coleta cancelada`,
        );
      }
    }
  }

  // 2. fila: ids do intervalo que ainda não foram feitos
  const feitos = lerFeitos(opcoes.pasta);
  const fila: number[] = [];
  let jaFeitos = 0;
  for (let id = opcoes.de; id <= opcoes.ate; id++) {
    if (feitos.has(id)) jaFeitos++;
    else fila.push(id);
  }
  const alvo = opcoes.limite === undefined ? fila : fila.slice(0, opcoes.limite);
  if (alvo.length === 0) {
    return {
      feitos: 0,
      jaFeitos,
      pendentes: fila.length,
      paradaPor: fila.length === 0 ? 'concluida' : 'limite',
    };
  }
  if (
    existsSync(caminhoRespostas) &&
    !readFileSync(caminhoRespostas, 'utf8').endsWith('\n') &&
    readFileSync(caminhoRespostas, 'utf8') !== ''
  ) {
    appendFileSync(caminhoRespostas, '\n');
  }

  const sessao = new Sessao(base, buscar, userAgent);
  await sessao.iniciar(alvo[0] as number);
  let feitosAgora = 0;
  let primeiro = true;

  const esperar = async (ms: number): Promise<void> => {
    await dormir(ms);
  };

  /** Um pedido com recuo em 429/5xx/erro de rede; 403 renova a sessão uma vez e depois para. */
  const pedir = async (id: number, inicio: number): Promise<Response> => {
    let renovou = false;
    for (let tentativa = 0; ; tentativa++) {
      let r: Response | undefined;
      let falha: string | undefined;
      try {
        r = await sessao.pedir(id, inicio, tamanho);
      } catch (erro) {
        falha = erro instanceof Error ? erro.message : String(erro);
      }
      if (r !== undefined) {
        if (r.status === 403 && !renovou) {
          renovou = true;
          await esperar(intervalo);
          await sessao.iniciar(id);
          continue;
        }
        if (r.status === 403) {
          throw new ErroArquivo(
            `o site recusou o pedido (HTTP 403) mesmo com sessão nova, no texto ${id}; não vou insistir`,
          );
        }
        if (r.status !== 429 && r.status < 500) return r;
        falha = `HTTP ${r.status}`;
        const depois = Number(r.headers.get('retry-after'));
        if (Number.isFinite(depois) && depois > 0 && tentativa < TENTATIVAS) {
          log(`texto ${id}: ${falha}; o site pediu para esperar ${depois}s`);
          await esperar(depois * 1000);
          continue;
        }
      }
      if (tentativa + 1 >= TENTATIVAS) {
        throw new ErroArquivo(
          `texto ${id}: ${falha} depois de ${TENTATIVAS} tentativas; parei (o progresso está salvo)`,
        );
      }
      const espera = ESPERA_BASE_MS * 2 ** tentativa;
      log(`texto ${id}: ${falha}; nova tentativa em ${Math.round(espera / 1000)}s`);
      await esperar(espera);
    }
  };

  try {
    for (const id of alvo) {
      const linhas: unknown[] = [];
      let status = 200;
      let total = 0;
      let paginas = 0;
      for (let inicio = 0; ;) {
        if (!primeiro) await esperar(Math.round(intervalo * (1 + aleatorio() * 0.25)));
        primeiro = false;
        const r = await pedir(id, inicio);
        if (r.status === 404) {
          status = 404;
          break;
        }
        if (!r.ok) throw new ErroArquivo(`texto ${id}: HTTP ${r.status} inesperado; parei`);
        let pagina: PaginaSite;
        try {
          pagina = lerPagina(await r.json());
        } catch (erro) {
          if (erro instanceof ErroArquivo) throw erro;
          throw new ErroArquivo(
            `texto ${id}: a resposta não é JSON; o site mudou ou pediu verificação; parei`,
          );
        }
        paginas++;
        total = pagina.recordsFiltered;
        linhas.push(...pagina.data);
        inicio += pagina.data.length;
        if (inicio >= total) break;
        if (pagina.data.length === 0) {
          throw new ErroArquivo(
            `texto ${id}: o site disse ${total} registros mas devolveu uma página vazia; parei`,
          );
        }
        if (paginas >= MAX_PAGINAS_POR_ID)
          throw new ErroArquivo(`texto ${id}: mais de ${MAX_PAGINAS_POR_ID} páginas; parei`);
      }
      if (status === 200 && linhas.length !== total) {
        throw new ErroArquivo(
          `texto ${id}: o site disse ${total} registros e devolveu ${linhas.length}; parei`,
        );
      }
      const registro: RespostaColetada = {
        idTexto: id,
        status,
        total: status === 404 ? 0 : total,
        paginas,
        coletadoEm: agora().toISOString().slice(0, 10),
        linhas,
      };
      appendFileSync(caminhoRespostas, JSON.stringify(registro) + '\n', 'utf8');
      feitosAgora++;
      if (feitosAgora % 100 === 0)
        log(`${feitosAgora} de ${alvo.length} ids nesta execução (último: ${id})`);
    }
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro);
    return {
      feitos: feitosAgora,
      jaFeitos,
      pendentes: fila.length - feitosAgora,
      paradaPor: 'erro',
      motivo,
    };
  }
  const pendentes = fila.length - feitosAgora;
  return {
    feitos: feitosAgora,
    jaFeitos,
    pendentes,
    paradaPor: pendentes === 0 ? 'concluida' : 'limite',
  };
}
