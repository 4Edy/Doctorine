import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executarPares } from './cli-pares.js';
import {
  coletarManejo,
  finalizarManejo,
  lerFeitosManejo,
  lerPaginaPar,
  montarFila,
  processarManejoGuardado,
  recortarPagina,
  type ItemFila,
} from './manejo.js';

const BASE = 'https://site.invalid';

interface Opcoes {
  manejo?: string;
  interacao?: string;
  refs?: string[];
  idsFarmacos?: [string, string];
  altA?: string[];
  altB?: string[];
}

/** Página no formato do site (conferido com o par 110952), encurtada. */
function pagina(o: Opcoes = {}): string {
  const [ida, idb] = o.idsFarmacos ?? ['DDInter1', 'DDInter2'];
  const refs = o.refs ?? ['"Product Information. Entresto."', 'Autor A &amp; B &quot;Titulo&quot;'];
  const links = (ids: string[]): string =>
    ids
      .map((i) => `<a href="/server/drug-detail/${i}/" class="col-md-2">\n Nome${i} \n</a>`)
      .join('');
  const script = (lado: string, ids: string[]): string =>
    ids
      .map(
        (i) =>
          `all_candidate_${lado}_html += '<a href="/server/drug-detail/${i}/" class="col-md-2">Nome${i}</a>';`,
      )
      .join('\n');
  return `<html><body><main>
<strong class="mx-2">
 Alfa</strong> and <strong class="mx-2">Beta</strong>
<table><tbody>
<tr><td class="key">ID</td><td class="value"><a href="/server/drug-detail/${ida}/">${ida}</a> and <a href="/server/drug-detail/${idb}/">${idb}</a></td></tr>
<tr><td class="key">Interaction</td><td class="value">
 ${o.interacao ?? 'Texto   da interacao.'}
</td></tr>
<tr><td class="key">Management</td><td class="value">
 ${o.manejo === undefined ? 'Evitar o uso conjunto.' : o.manejo}
</td></tr>
<tr><td class="key">References</td><td id="reference-text" class="value">
${refs.map((r, i) => `<span class="d-block my-2">[${i + 1}] ${r}</span>`).join('\n')}
</td></tr>
<tr><td class="key">Alternative for <span style="color: #a94442">Alfa</span> <i></i></td>
<td class="value"><span class="badge text-bg-dark">C09A</span><div class="row"></div>
<br><span class="badge text-bg-dark">C09B</span>${links(o.altA ?? ['DDInter10', 'DDInter11'])}</td></tr>
<tr><td class="key">Alternative for <span style="color: #a94442">Beta</span> <i></i></td>
<td class="value"><span class="badge text-bg-dark">C09D</span>${links(o.altB ?? ['DDInter20'])}</td></tr>
</tbody></table></main>
<script>
${script('a', o.altA ?? ['DDInter10', 'DDInter11'])}
${script('b', o.altB ?? ['DDInter20'])}
</script>
<footer>rodape</footer></body></html>`;
}

describe('lerPaginaPar', () => {
  it('lê textos, referências, medicamentos e alternativas por grupo ATC', () => {
    const p = lerPaginaPar(recortarPagina(pagina()));
    expect(p.interacao).toBe('Texto da interacao.');
    expect(p.manejo).toBe('Evitar o uso conjunto.');
    expect(p.idsFarmacos).toEqual(['DDInter1', 'DDInter2']);
    expect(p.nomes).toEqual(['Alfa', 'Beta']);
    expect(p.referencias).toEqual(['"Product Information. Entresto."', 'Autor A & B "Titulo"']);
    expect(p.alternativas[0]).toMatchObject({ nome: 'Alfa', idFarmaco: 'DDInter1' });
    expect(p.alternativas[0]?.grupos).toEqual([
      { atc: 'C09A', farmacos: [] },
      {
        atc: 'C09B',
        farmacos: [
          { id: 'DDInter10', nome: 'NomeDDInter10' },
          { id: 'DDInter11', nome: 'NomeDDInter11' },
        ],
      },
    ]);
    expect(p.alternativas[1]?.completo).toEqual([{ id: 'DDInter20', nome: 'NomeDDInter20' }]);
  });

  it('manejo vazio vira null, sem inventar texto', () => {
    expect(lerPaginaPar(pagina({ manejo: '   ', refs: [] }))).toMatchObject({
      manejo: null,
      referencias: [],
    });
  });

  it('falha, em vez de chutar, se a estrutura mudou', () => {
    expect(() => lerPaginaPar('<html><main>nada</main></html>')).toThrow(/fora do formato/);
    expect(() => recortarPagina('<html>sem main</html>')).toThrow(/sem <main>/);
  });
});

describe('montarFila', () => {
  const pares = [
    { idPar: 5, idTexto: 1 },
    { idPar: 3, idTexto: 1 },
    { idPar: 9, idTexto: 2 },
    { idPar: 7, idTexto: 3 },
    { idPar: 8, idTexto: 3 },
    { idPar: 6, idTexto: 3 },
  ];
  it('um par principal por texto (o menor id) e amostras só em textos com 2+ pares', () => {
    const f = montarFila(pares, 2);
    expect(f.filter((i) => i.papel === 'principal')).toEqual([
      { idPar: 3, idTexto: 1, papel: 'principal' },
      { idPar: 9, idTexto: 2, papel: 'principal' },
      { idPar: 6, idTexto: 3, papel: 'principal' },
    ]);
    const amostras = f.filter((i) => i.papel === 'amostra');
    expect(amostras).toHaveLength(2);
    expect(amostras.every((a) => a.idTexto !== 2)).toBe(true);
    expect(
      amostras.every((a) => !f.some((x) => x.papel === 'principal' && x.idPar === a.idPar)),
    ).toBe(true);
  });
});

describe('coleta, fechamento e processamento', () => {
  let pasta: string;
  beforeEach(() => {
    pasta = mkdtempSync(join(tmpdir(), 'doctorine-manejo-'));
  });
  afterEach(() => rmSync(pasta, { recursive: true, force: true }));

  const fila: ItemFila[] = [
    { idPar: 10, idTexto: 1, papel: 'principal' },
    { idPar: 20, idTexto: 2, papel: 'principal' },
    { idPar: 11, idTexto: 1, papel: 'amostra' },
  ];
  const servidor = (paginas: Record<number, Response | string>, pedidos: string[] = []) =>
    (async (url: string | URL | Request) => {
      const u = String(url);
      pedidos.push(u);
      if (u.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow: /admin/\n');
      const id = Number(/interact\/(\d+)\//.exec(u)?.[1]);
      const r = paginas[id];
      if (r === undefined) return new Response('nao existe', { status: 404 });
      return typeof r === 'string' ? new Response(`<html><body>${r}</body></html>`) : r;
    }) as typeof fetch;
  const base = (buscar: typeof fetch, esperas: number[] = []) => ({
    pasta,
    fila,
    baseUrl: BASE,
    buscar,
    dormir: async (ms: number) => void esperas.push(ms),
    aleatorio: () => 0,
    agora: () => new Date('2026-11-14T10:00:00Z'),
  });

  it('pede uma página por vez, com intervalo, e continua de onde parou', async () => {
    const pedidos: string[] = [];
    const esperas: number[] = [];
    const buscar = servidor({ 10: pagina(), 20: pagina(), 11: pagina() }, pedidos);
    const r1 = await coletarManejo({ ...base(buscar, esperas), limite: 2 });
    expect(r1).toMatchObject({ feitos: 2, pendentes: 1, paradaPor: 'limite' });
    expect(esperas).toEqual([1500]);
    const r2 = await coletarManejo(base(buscar));
    expect(r2).toMatchObject({ feitos: 1, jaFeitos: 2, pendentes: 0, paradaPor: 'concluida' });
    expect(pedidos.filter((p) => p.includes('/interact/'))).toHaveLength(3);
    expect(lerFeitosManejo(pasta).get(10)?.html.startsWith('<main')).toBe(true);
  });

  it('respeita o robots.txt e para sem insistir em 403', async () => {
    const proibido = (async (url: string | URL | Request) =>
      String(url).endsWith('/robots.txt')
        ? new Response('User-agent: *\nDisallow: /server/\n')
        : new Response('x')) as typeof fetch;
    await expect(coletarManejo(base(proibido))).rejects.toThrow(/não permite acessar/);
    const r = await coletarManejo(base(servidor({ 10: new Response('no', { status: 403 }) })));
    expect(r.paradaPor).toBe('erro');
    expect(r.motivo).toMatch(/403/);
  });

  it('para com o motivo se a página não tiver o formato conhecido', async () => {
    const r = await coletarManejo(base(servidor({ 10: '<main>verificação</main>' })));
    expect(r).toMatchObject({ paradaPor: 'erro', feitos: 0 });
    expect(r.motivo).toMatch(/par 10: página fora do formato/);
  });

  it('5xx: recua em dobro e desiste depois de 5 tentativas', async () => {
    const esperas: number[] = [];
    const r = await coletarManejo(
      base(servidor({ 10: new Response('x', { status: 503 }) }), esperas),
    );
    expect(r.motivo).toMatch(/HTTP 503 depois de 5 tentativas/);
    expect(esperas).toEqual([30000, 60000, 120000, 240000]);
  });

  async function fechar(paginas: Record<number, string>) {
    await coletarManejo(base(servidor(paginas)));
    const f = finalizarManejo({ pasta, destino: join(pasta, 'bruto'), fila, baseUrl: BASE });
    return processarManejoGuardado(f.diretorio, join(pasta, 'processado'), {
      farmacosDoPar: new Map([
        [10, ['DDInter1', 'DDInter2']],
        [20, ['DDInter1', 'DDInter2']],
        [11, ['DDInter1', 'DDInter2']],
      ]),
      textoDaExportacao: new Map([
        [1, 'Texto da interacao.'],
        [2, 'Texto da interacao.'],
      ]),
    });
  }

  it('só finaliza com toda a fila, e o mesmo conteúdo dá a mesma versão', async () => {
    await coletarManejo({ ...base(servidor({ 10: pagina() })), limite: 1 });
    expect(() => finalizarManejo({ pasta, destino: join(pasta, 'b'), fila })).toThrow(
      /faltam 2 páginas/,
    );
    await coletarManejo(base(servidor({ 10: pagina(), 20: pagina(), 11: pagina() })));
    const a = finalizarManejo({ pasta, destino: join(pasta, 'b'), fila, baseUrl: BASE });
    const b = finalizarManejo({ pasta, destino: join(pasta, 'b'), fila, baseUrl: BASE });
    expect(a.novo).toBe(true);
    expect(b.novo).toBe(false);
    expect(b.manifesto.sha256).toBe(a.manifesto.sha256);
  });

  it('gera textos, alternativas por par e confere a amostra', async () => {
    const r = await fechar({ 10: pagina(), 20: pagina(), 11: pagina() });
    const rel = r.resultado.relatorio;
    expect(rel.textos).toMatchObject({ total: 2, comManejo: 2, referenciasTotal: 4 });
    expect(rel.verificacao).toEqual({ comparadas: 1, iguais: 1, divergentes: 0 });
    expect(rel.avisos.total).toBe(0);
    expect(r.resultado.textos[0]).toMatchObject({
      idTexto: 1,
      idParLido: 10,
      proveniencia: { url: `${BASE}/server/interact/10/`, data: '2026-11-14' },
    });
    // uma lista por par lido e por medicamento (3 páginas x 2 medicamentos), com o parceiro anotado
    expect(r.resultado.alternativas).toHaveLength(6);
    expect(r.resultado.alternativas[0]).toMatchObject({
      idPar: 10,
      idTexto: 1,
      idFarmaco: 'DDInter1',
      idParceiro: 'DDInter2',
    });
    expect(r.resultado.relatorio.alternativas).toEqual({
      registros: 6,
      semAlternativas: 0,
      farmacos: 2,
    });
    expect(readFileSync(join(r.diretorioSaida, 'relatorio-qualidade.md'), 'utf8')).toContain(
      '1 iguais, 0 diferentes',
    );
  });

  it('avisa quando o manejo muda dentro do texto, quando o texto não bate e quando a página é outra', async () => {
    const r = await fechar({
      10: pagina(),
      11: pagina({ manejo: 'Outro manejo.' }),
      20: pagina({ interacao: 'Texto diferente.', idsFarmacos: ['DDInter1', 'DDInter9'] }),
    });
    const tipos = r.resultado.relatorio.avisos.porTipo;
    expect(tipos).toMatchObject({
      'manejo-diverge-no-texto': 1,
      'interacao-diferente-da-exportacao': 1,
      'farmacos-diferentes-do-par': 1,
    });
    expect(r.resultado.relatorio.verificacao.divergentes).toBe(1);
  });

  it('não junta alternativas de pares diferentes: o mesmo medicamento pode ter listas diferentes', async () => {
    const r = await fechar({
      10: pagina(),
      11: pagina(),
      20: pagina({ altA: ['DDInter99'] }),
    });
    expect(r.resultado.relatorio.avisos.total).toBe(0);
    const doPar20 = r.resultado.alternativas.find(
      (a) => a.idPar === 20 && a.idFarmaco === 'DDInter1',
    );
    const doPar10 = r.resultado.alternativas.find(
      (a) => a.idPar === 10 && a.idFarmaco === 'DDInter1',
    );
    expect(doPar20?.completo.map((f) => f.id)).toEqual(['DDInter99']);
    expect(doPar10?.completo.map((f) => f.id)).toEqual(['DDInter10', 'DDInter11']);
  });

  it('rejeita arquivo adulterado', async () => {
    await coletarManejo(base(servidor({ 10: pagina(), 20: pagina(), 11: pagina() })));
    const f = finalizarManejo({ pasta, destino: join(pasta, 'b'), fila });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(f.diretorio, 'respostas-manejo.jsonl'), 'x\n');
    expect(() => processarManejoGuardado(f.diretorio, join(pasta, 'p'))).toThrow(/checksum/);
  });
});

describe('CLI do manejo', () => {
  let raiz: string;
  beforeEach(() => {
    raiz = mkdtempSync(join(tmpdir(), 'doctorine-cli-manejo-'));
  });
  afterEach(() => rmSync(raiz, { recursive: true, force: true }));
  const buscar = (async (url: string | URL | Request) =>
    String(url).endsWith('/robots.txt')
      ? new Response('')
      : new Response(pagina({ refs: ['a', 'b', 'c'] }))) as typeof fetch;
  const deps = () => ({ raiz, buscar, dormir: async () => undefined, aleatorio: () => 0 });

  it('--teste coleta só o par 110952 numa pasta à parte e mostra o que foi lido', async () => {
    const r = await executarPares(['coletar-manejo', '--teste'], deps());
    expect(r.codigo).toBe(0);
    expect(r.linhas.join('\n')).toMatch(/Lido do par 110952: Alfa \+ Beta; manejo: Evitar/);
    expect(r.linhas.join('\n')).toMatch(/3 referências/);
    expect(lerFeitosManejo(join(raiz, 'data', 'raw', 'ddinter-manejo', '_coleta-teste')).size).toBe(
      1,
    );
  });

  it('sem a lista de pares processada, pede para rodar "pares" antes', async () => {
    const r = await executarPares(['coletar-manejo'], deps());
    expect(r.codigo).toBe(1);
    expect(r.linhas.join('\n')).toMatch(/rode "pares" antes/);
  });

  it('recusa opção desconhecida', async () => {
    expect((await executarPares(['manejo', '--limite', '3'], deps())).codigo).toBe(2);
  });
});
