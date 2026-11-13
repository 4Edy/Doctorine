import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  caminhoProibido,
  coletar,
  lerFeitos,
  regrasRobots,
  type OpcoesColetar,
} from './coletor.js';
import { executar } from './cli.js';
import {
  finalizarColeta,
  processarPares,
  processarParesGuardado,
  type ManifestoPares,
} from './pares.js';

const BASE = 'https://site.invalid';

/** Linha de par como o site devolve (exemplo real do texto 9, id de par 110952). */
const par = (
  id: number,
  a: number,
  b: number,
  nivel = '3',
  extra: Record<string, string> = {},
) => ({
  level: nivel,
  drugbankID_a: `DB${String(a).padStart(5, '0')}`,
  internalID_a: `DDInter${a}`,
  drug_a_name: `Drug${a}`,
  drugbankID_b: `DB${String(b).padStart(5, '0')}`,
  internalID_b: `DDInter${b}`,
  drug_b_name: `Drug${b}`,
  id,
  antagonistic_effect: '0',
  synergistic_effect: '1',
  absorption: '0',
  distribution: '0',
  metabolism: '0',
  excretion: '0',
  others: '0',
  ...extra,
});

interface Servidor {
  buscar: typeof fetch;
  pedidos: Array<{
    metodo: string;
    url: string;
    corpo: string;
    cabecalhos: Record<string, string>;
  }>;
  /** Comportamento por id: lista de pares, ou função para simular falhas. */
  textos: Map<number, unknown[] | ((tentativa: number) => Response)>;
  robots: string | null;
  tentativas: Map<number, number>;
}

function servidor(): Servidor {
  const s: Servidor = {
    pedidos: [],
    textos: new Map(),
    robots: null,
    tentativas: new Map(),
    buscar: undefined as never,
  };
  s.buscar = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const cabecalhos = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>),
    );
    s.pedidos.push({
      metodo: init?.method ?? 'GET',
      url: u,
      corpo: String(init?.body ?? ''),
      cabecalhos,
    });
    if (u.endsWith('/robots.txt'))
      return s.robots === null ? new Response('', { status: 404 }) : new Response(s.robots);
    if (u.includes('/server/inter-detail/')) {
      return new Response(
        '<form><input type="hidden" name="csrfmiddlewaretoken" value="TOKEN123"></form>',
        {
          headers: [['set-cookie', 'csrftoken=COOKIE456; Path=/; SameSite=Lax']],
        },
      );
    }
    const id = Number(/inter-list\/(\d+)\//.exec(u)?.[1]);
    const regra = s.textos.get(id);
    if (regra === undefined) return new Response('nao existe', { status: 404 });
    if (typeof regra === 'function') {
      const n = (s.tentativas.get(id) ?? 0) + 1;
      s.tentativas.set(id, n);
      return regra(n);
    }
    const p = new URLSearchParams(String(init?.body));
    const inicio = Number(p.get('start'));
    const tam = Number(p.get('length'));
    return Response.json({
      draw: 1,
      recordsTotal: regra.length,
      recordsFiltered: regra.length,
      data: regra.slice(inicio, inicio + tam),
    });
  }) as typeof fetch;
  return s;
}

let pasta: string;
let esperas: number[];
const base = (s: Servidor, extra: Partial<OpcoesColetar> = {}): OpcoesColetar => ({
  pasta,
  de: 9,
  ate: 12,
  baseUrl: BASE,
  buscar: s.buscar,
  dormir: async (ms) => void esperas.push(ms),
  aleatorio: () => 0,
  agora: () => new Date('2026-11-13T10:00:00Z'),
  ...extra,
});
beforeEach(() => {
  pasta = mkdtempSync(join(tmpdir(), 'doctorine-coleta-'));
  esperas = [];
});
afterEach(() => rmSync(pasta, { recursive: true, force: true }));

const comTextos = (): Servidor => {
  const s = servidor();
  s.textos.set(9, [par(110952, 1237, 1630)]);
  s.textos.set(10, [par(5, 1, 2, '2'), par(6, 1, 3, '2')]);
  s.textos.set(11, []);
  // 12 não existe: o site devolve 404
  return s;
};

describe('robots.txt', () => {
  it('lê o grupo "*" e respeita prefixos', () => {
    const regras = regrasRobots(
      'User-agent: bot\nDisallow: /\n\nUser-agent: *\nDisallow: /server/inter-list/ # nao\nDisallow:\nAllow: /server/\n',
    );
    expect(regras).toEqual(['/server/inter-list/']);
    expect(caminhoProibido('/server/inter-list/', regras)).toBe(true);
    expect(caminhoProibido('/server/interact/', regras)).toBe(false);
    expect(regrasRobots('User-agent: a\nUser-agent: *\nDisallow: /x')).toEqual(['/x']);
  });

  it('cancela a coleta, sem pedir nada além do robots, se o site proíbe', async () => {
    const s = comTextos();
    s.robots = 'User-agent: *\nDisallow: /server/\n';
    await expect(coletar(base(s))).rejects.toThrow(/robots.txt.*não permite/);
    expect(s.pedidos.map((p) => p.url)).toEqual([`${BASE}/robots.txt`]);
  });
});

describe('coletar', () => {
  it('abre a página, usa o token e o cookie, e se identifica', async () => {
    const s = comTextos();
    const r = await coletar(base(s, { contato: 'eu@exemplo.invalid' }));
    expect(r).toMatchObject({ feitos: 4, jaFeitos: 0, pendentes: 0, paradaPor: 'concluida' });
    const post = s.pedidos.find((p) => p.metodo === 'POST');
    expect(post?.url).toBe(`${BASE}/server/inter-list/9/`);
    expect(new URLSearchParams(post?.corpo).get('csrfmiddlewaretoken')).toBe('TOKEN123');
    expect(post?.cabecalhos).toMatchObject({
      cookie: 'csrftoken=COOKIE456',
      'x-csrftoken': 'TOKEN123',
      referer: `${BASE}/server/inter-detail/9/`,
      origin: BASE,
      'x-requested-with': 'XMLHttpRequest',
    });
    expect(post?.cabecalhos['user-agent']).toContain('doctorine-pipeline');
    expect(post?.cabecalhos['user-agent']).toContain('eu@exemplo.invalid');
  });

  it('um pedido por vez, com intervalo entre todos (menos antes do primeiro)', async () => {
    const s = comTextos();
    await coletar(base(s, { intervaloMs: 2000 }));
    expect(esperas).toEqual([2000, 2000, 2000]);
    const ordem = s.pedidos
      .filter((p) => p.metodo === 'POST')
      .map((p) => p.url.match(/\/(\d+)\/$/)?.[1]);
    expect(ordem).toEqual(['9', '10', '11', '12']);
  });

  it('guarda texto sem pares e texto inexistente (404) sem tratar como erro', async () => {
    const s = comTextos();
    await coletar(base(s));
    const feitos = lerFeitos(pasta);
    expect(feitos.get(11)).toMatchObject({ status: 200, total: 0, linhas: [] });
    expect(feitos.get(12)).toMatchObject({ status: 404, total: 0, linhas: [] });
    expect(feitos.get(10)?.linhas).toHaveLength(2);
  });

  it('pagina quando o texto tem mais pares que a página', async () => {
    const s = servidor();
    s.textos.set(
      9,
      Array.from({ length: 5 }, (_, i) => par(100 + i, 1, 10 + i)),
    );
    const r = await coletar(base(s, { ate: 9, tamanhoPagina: 2 }));
    expect(r.paradaPor).toBe('concluida');
    expect(lerFeitos(pasta).get(9)).toMatchObject({ total: 5, paginas: 3 });
    expect(lerFeitos(pasta).get(9)?.linhas).toHaveLength(5);
  });

  it('continua de onde parou e não repete ids feitos', async () => {
    const s = comTextos();
    const a = await coletar(base(s, { limite: 2 }));
    expect(a).toMatchObject({ feitos: 2, pendentes: 2, paradaPor: 'limite' });
    const antes = s.pedidos.length;
    const b = await coletar(base(s));
    expect(b).toMatchObject({ feitos: 2, jaFeitos: 2, pendentes: 0, paradaPor: 'concluida' });
    const novos = s.pedidos
      .slice(antes)
      .filter((p) => p.metodo === 'POST')
      .map((p) => p.url.match(/\/(\d+)\/$/)?.[1]);
    expect(novos).toEqual(['11', '12']);
    const c = await coletar(base(s));
    expect(c).toMatchObject({ feitos: 0, jaFeitos: 4, paradaPor: 'concluida' });
  });

  it('ignora a última linha cortada por uma interrupção e refaz esse id', async () => {
    const s = comTextos();
    await coletar(base(s, { limite: 2 }));
    appendFileSync(join(pasta, 'respostas.jsonl'), '{"idTexto":11,"status":200,"tot');
    const r = await coletar(base(s));
    expect(r).toMatchObject({ jaFeitos: 2, feitos: 2, paradaPor: 'concluida' });
    expect(lerFeitos(pasta).size).toBe(4);
  });

  it('429: espera o que o site pediu e tenta de novo; 5xx: recua em dobro a cada tentativa', async () => {
    const s = comTextos();
    s.textos.set(9, (n) =>
      n === 1
        ? new Response('', { status: 429, headers: { 'retry-after': '7' } })
        : n === 2
          ? new Response('', { status: 503 })
          : Response.json({ recordsFiltered: 1, data: [par(1, 1, 2)] }),
    );
    const r = await coletar(base(s, { ate: 9, intervaloMs: 1000 }));
    expect(r.paradaPor).toBe('concluida');
    // o pedido de espera do site conta como uma tentativa: o recuo seguinte já é o da segunda
    expect(esperas).toEqual([7000, 60000]);
    expect(lerFeitos(pasta).get(9)?.linhas).toHaveLength(1);
  });

  it('desiste depois de 5 falhas seguidas, sem perder o que já foi feito', async () => {
    const s = comTextos();
    s.textos.set(10, () => new Response('', { status: 500 }));
    const r = await coletar(base(s));
    expect(r.paradaPor).toBe('erro');
    expect(r.motivo).toMatch(/texto 10: HTTP 500 depois de 5 tentativas/);
    expect(r).toMatchObject({ feitos: 1, pendentes: 3 });
    expect(esperas.filter((e) => e >= 30000)).toEqual([30000, 60000, 120000, 240000]);
    expect([...lerFeitos(pasta).keys()]).toEqual([9]);
  });

  it('403: renova a sessão uma vez; se continuar, para sem insistir', async () => {
    const s = comTextos();
    s.textos.set(10, () => new Response('', { status: 403 }));
    const r = await coletar(base(s));
    expect(r.paradaPor).toBe('erro');
    expect(r.motivo).toMatch(/HTTP 403.*não vou insistir/);
    const posts10 = s.pedidos.filter((p) => p.url.endsWith('/inter-list/10/'));
    expect(posts10).toHaveLength(2);
    expect(s.pedidos.filter((p) => p.url.includes('/inter-detail/'))).toHaveLength(2);
  });

  it('para se a resposta não for JSON, mudar de formato ou vier incompleta', async () => {
    for (const resposta of [
      new Response('<html>verifique que voce e humano</html>'),
      Response.json({ foo: 1 }),
      Response.json({ recordsFiltered: 3, data: [] }),
    ]) {
      const s = servidor();
      s.textos.set(9, () => resposta.clone());
      const r = await coletar(base(s, { ate: 9 }));
      expect(r.paradaPor).toBe('erro');
      expect(r.feitos).toBe(0);
    }
  });

  it('recusa intervalo curto demais e faixa inválida', async () => {
    const s = comTextos();
    await expect(coletar(base(s, { intervaloMs: 100 }))).rejects.toThrow(/intervalo mínimo/);
    await expect(coletar(base(s, { de: 5, ate: 2 }))).rejects.toThrow(/inválido/);
    await expect(coletar(base(s, { tamanhoPagina: 5000 }))).rejects.toThrow(/tamanho de página/);
  });

  it('falha com mensagem clara se a página não trouxer token', async () => {
    const s = comTextos();
    const original = s.buscar;
    s.buscar = (async (u: string | URL | Request, i?: RequestInit) =>
      String(u).includes('/inter-detail/')
        ? new Response('<html></html>')
        : original(u, i)) as typeof fetch;
    await expect(coletar(base(s))).rejects.toThrow(/token CSRF/);
  });
});

describe('finalizar e processar', () => {
  const destino = () => join(pasta, 'raw');

  it('só finaliza com todos os ids, e o mesmo conteúdo dá a mesma versão', async () => {
    const s = comTextos();
    await coletar(base(s, { limite: 2, pasta: join(pasta, '_c') }));
    expect(() => finalizarColeta({ pasta: join(pasta, '_c'), destino: destino() })).toThrow(
      /faltam 2 ids/,
    );
    await coletar(base(s, { pasta: join(pasta, '_c') }));
    const a = finalizarColeta({ pasta: join(pasta, '_c'), destino: destino() });
    const b = finalizarColeta({ pasta: join(pasta, '_c'), destino: destino() });
    expect(a.novo).toBe(true);
    expect(b.novo).toBe(false);
    expect(a.manifesto.idsPedidos).toEqual({
      de: 9,
      ate: 12,
      total: 4,
      comPares: 2,
      semPares: 1,
      naoEncontrados: 1,
    });
    expect(a.manifesto.baixadoEm).toBe('2026-11-13');
    expect(readdirSync(a.diretorio).sort()).toEqual(['manifesto.json', 'pares-brutos.jsonl']);
    expect(() => finalizarColeta({ pasta: join(pasta, 'nada'), destino: destino() })).toThrow(
      /nenhuma coleta/,
    );
  });

  const montar = async (extra: Record<number, unknown[]> = {}) => {
    const s = comTextos();
    for (const [id, l] of Object.entries(extra)) s.textos.set(Number(id), l);
    await coletar(base(s, { pasta: join(pasta, '_c') }));
    return finalizarColeta({ pasta: join(pasta, '_c'), destino: destino() });
  };
  const ler = (dir: string) => ({
    bytes: readFileSync(join(dir, 'pares-brutos.jsonl')),
    manifesto: JSON.parse(readFileSync(join(dir, 'manifesto.json'), 'utf8')) as ManifestoPares,
  });

  it('gera pares com menor id primeiro, DrugBank, mecanismo e proveniência', async () => {
    const f = await montar({ 9: [par(110952, 1630, 1237)] });
    const r = processarPares(ler(f.diretorio));
    const p = r.pares.find((x) => x.idPar === 110952);
    expect(p).toMatchObject({
      idTexto: 9,
      nivel: 'Major',
      mecanismos: ['Synergy'],
      a: { id: 'DDInter1237', drugbank: 'DB01237', nome: 'Drug1237' },
      b: { id: 'DDInter1630' },
    });
    expect(p?.proveniencia).toMatchObject({
      fonte: 'ddinter-site-lista-de-pares',
      idTexto: 9,
      posicao: 1,
      data: '2026-11-13',
    });
    expect(r.relatorio.pares).toMatchObject({ registros: 3, idsDePar: 3, paresDeMedicamentos: 3 });
    expect(r.farmacos.find((x) => x.id === 'DDInter1')?.pares).toBe(2);
  });

  it('rejeita linha inválida com motivo e mede repetições', async () => {
    const f = await montar({
      10: [
        par(5, 1, 2, '2'),
        par(5, 1, 2, '2'),
        par(8, 3, 3),
        par(9, 1, 2, '9'),
        par(7, 4, 5, '2', { synergistic_effect: '7' }),
      ],
      11: [par(5, 1, 2, '2')],
    });
    const r = processarPares(ler(f.diretorio));
    expect(r.rejeicoes.map((x) => x.posicao)).toEqual([3, 4, 5]);
    expect(r.rejeicoes[1]?.motivos[0]).toContain('nível fora');
    expect(r.relatorio.pares).toMatchObject({ idParEmVariosTextos: 1, paresComVariosIds: 0 });
  });

  it('avisa de DrugBank e nome divergentes, e de nível diferente do texto', async () => {
    const f = await montar({
      10: [par(5, 1, 2, '2'), par(6, 1, 3, '2', { drugbankID_a: 'DB99999', drug_a_name: 'Outro' })],
    });
    const r = processarPares(ler(f.diretorio), {
      nivelDoTexto: new Map([
        [9, 'Major'],
        [10, 'Major'],
      ]),
    });
    expect(r.relatorio.avisos.porTipo).toEqual({
      'drugbank-divergente': 1,
      'nome-divergente': 1,
      'nivel-diferente-do-texto': 2,
    });
  });

  it('confere com os pares dos 8 CSVs: só na coleta, só nos CSVs, nível diferente', async () => {
    const f = await montar();
    const csv = new Map<string, 'Major' | 'Moderate' | 'Minor' | 'Unknown'>([
      ['DDInter1237|DDInter1630', 'Major'],
      ['DDInter1|DDInter2', 'Minor'],
      ['DDInter50|DDInter51', 'Unknown'],
    ]);
    const r = processarPares(ler(f.diretorio), { paresCsv: csv });
    expect(r.relatorio.conferencia.csv).toMatchObject({
      paresNoCsv: 3,
      emAmbos: 2,
      soNaColeta: 1,
      soNoCsv: 1,
      mesmoNivel: 1,
      nivelDiferente: 1,
    });
  });

  it('recusa arquivo adulterado e grava saída idêntica em duas execuções', async () => {
    const f = await montar();
    const ruim = ler(f.diretorio);
    ruim.bytes = Buffer.concat([ruim.bytes, Buffer.from('\n')]);
    expect(() => processarPares(ruim)).toThrow(/checksum não confere/);
    const lerSaida = (d: string) =>
      Object.fromEntries(readdirSync(d).map((n) => [n, readFileSync(join(d, n), 'utf8')]));
    const a = processarParesGuardado(f.diretorio, join(pasta, 'proc'));
    const primeira = lerSaida(a.diretorioSaida);
    processarParesGuardado(f.diretorio, join(pasta, 'proc'));
    expect(lerSaida(a.diretorioSaida)).toEqual(primeira);
    expect(Object.keys(primeira)).toContain('pares.jsonl');
  });
});

describe('CLI de pares', () => {
  let raiz: string;
  beforeEach(() => {
    raiz = mkdtempSync(join(tmpdir(), 'doctorine-cli-pares-'));
  });
  afterEach(() => rmSync(raiz, { recursive: true, force: true }));
  const deps = (s: Servidor, progresso?: (l: string) => void) => ({
    raiz,
    buscar: s.buscar,
    dormir: async () => undefined,
    aleatorio: () => 0,
    agora: () => new Date('2026-11-13T10:00:00Z'),
    ...(progresso ? { progresso } : {}),
  });

  it('--teste coleta só o texto 9 numa pasta à parte e mostra a resposta', async () => {
    const s = comTextos();
    const r = await executar(['coletar-pares', '--teste', '--base-url', BASE], deps(s));
    expect(r.codigo).toBe(0);
    expect(r.linhas.join('\n')).toContain('Moexipril');
    expect(r.linhas.join('\n')).toContain('"idTexto":9');
    expect(readdirSync(join(raiz, 'data', 'raw', 'ddinter-pares'))).toEqual(['_coleta-teste']);
  });

  it('coleta, finaliza e processa de ponta a ponta', async () => {
    const s = comTextos();
    const c = await executar(
      ['coletar-pares', '--de', '9', '--ate', '12', '--base-url', BASE, '--intervalo', '800'],
      deps(s),
    );
    expect(c.codigo).toBe(0);
    expect(c.linhas.join('\n')).toContain('4 ids pedidos agora');
    const p = await executar(['pares'], deps(s));
    expect(p.codigo).toBe(0);
    expect(p.linhas.join('\n')).toContain('3 registros + 0 rejeitadas');
  });

  it('sem faixa e sem exportações processadas, pede --de e --ate', async () => {
    const r = await executar(['coletar-pares'], deps(comTextos()));
    expect(r.codigo).toBe(1);
    expect(r.linhas.join('\n')).toContain('--de e --ate');
  });

  it('devolve 1 com o motivo quando a coleta para por erro, e 2 para uso incorreto', async () => {
    const s = comTextos();
    s.textos.set(9, () => new Response('', { status: 403 }));
    const r = await executar(
      ['coletar-pares', '--de', '9', '--ate', '9', '--base-url', BASE],
      deps(s),
    );
    expect(r.codigo).toBe(1);
    expect(r.linhas.join('\n')).toContain('HTTP 403');
    for (const argv of [
      ['coletar-pares', '--de'],
      ['coletar-pares', '--de', 'x', '--ate', '3'],
      ['coletar-pares', '--voar', '1'],
      ['pares', '--teste'],
      ['finalizar-pares', '--de', '1'],
    ]) {
      expect((await executar(argv, deps(s))).codigo === 2 || argv.includes('x')).toBe(true);
    }
  });
});
