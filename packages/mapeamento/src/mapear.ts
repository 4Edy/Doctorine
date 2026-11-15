import type { Decisao } from './decisoes.js';
import { IndiceDeNomes, variantesEmIngles, type Candidato } from './cognatos.js';
import { chaveDe } from './normalizar.js';
import { nomeSemSal, removerSal, removerSalComoSugestao } from './sal.js';
import { LIMITE_TRUNCAMENTO, separarComponentes } from './separar.js';

/** Sobe quando uma regra do mapeamento automático muda: entra na versão da base. */
export const VERSAO_REGRAS = 1;

export class ErroMapeamento extends Error {
  override name = 'ErroMapeamento';
}

export type StatusMapeamento = 'automatico' | 'confirmado' | 'pendente';

export interface MedicamentoEntrada {
  id: number;
  nome: string;
  ativo: boolean;
  principioAtivoOriginal: string | null;
}
export interface FarmacoEntrada {
  id: number;
  nomeEn: string;
}
export interface EntradaMapeamento {
  medicamentos: readonly MedicamentoEntrada[];
  farmacos: readonly FarmacoEntrada[];
  decisoes: readonly Decisao[];
  limiteTruncamento?: number;
  /** Nomes de princípios ativos do conjunto de referência da farmacêutica. */
  referencia?: ReadonlyArray<{ id: string; nome: string }>;
}

export interface PrincipioSaida {
  slug: string;
  nomePt: string;
  nomeEn: string | null;
  ddinterIds: number[];
}
export interface NomeSaida {
  slug: string;
  idioma: 'pt' | 'en';
  nome: string;
  fonte: 'anvisa' | 'ddinter' | 'decisao';
}
export interface MapeamentoSaida {
  origem: 'ddinter-farmaco' | 'anvisa-componente';
  chaveOrigem: string;
  slug: string | null;
  status: StatusMapeamento;
  motivo: string | null;
}
export interface LigacaoSaida {
  medicamentoId: number;
  ordem: number;
  slug: string;
}
export interface MedicamentoSaida {
  medicamentoId: number;
  componentes: number;
  /** Componentes sem princípio ativo confirmado ou automático (inclui o cortado pela ANVISA). */
  pendentes: number;
  truncado: boolean;
}
export interface ItemFila {
  posicao: number;
  chave: string;
  textoExemplo: string;
  medicamentosAtivos: number;
  medicamentosTotal: number;
  motivo: string;
  candidatos: Candidato[];
  exemplos: string[];
}
export interface ItemAutomatico {
  chave: string;
  textoExemplo: string;
  medicamentosAtivos: number;
  ddinterIds: number[];
  nomesEn: string[];
  motivo: string;
}
export interface SituacaoReferencia {
  id: string;
  nome: string;
  situacao: StatusMapeamento | 'nao-encontrado';
  slug: string | null;
}
export interface Cobertura {
  medicamentos: {
    total: number;
    ativos: number;
    ativosSemPrincipio: number;
    ativosComTexto: number;
  };
  ativos: { completos: number; parciais: number; nenhumMapeado: number; comTextoCortado: number };
  percentualCompletos: number;
  componentes: { distintos: number; automatico: number; confirmado: number; pendente: number };
  principios: number;
  farmacosLigados: number;
  /** Se os N primeiros itens da fila forem resolvidos, que % dos ativos com texto fica completo. */
  seResolvidos: Array<{ primeiros: number; percentual: number }>;
}
export interface SaidaMapeamento {
  principios: PrincipioSaida[];
  nomes: NomeSaida[];
  mapeamentos: MapeamentoSaida[];
  ligacoes: LigacaoSaida[];
  medicamentos: MedicamentoSaida[];
  fila: ItemFila[];
  automaticos: ItemAutomatico[];
  cobertura: Cobertura;
  referencia: SituacaoReferencia[];
  avisos: string[];
  /** Sais e hidratos tirados no mapeamento automático, por regra (para a farmacêutica conferir). */
  regrasDeSalUsadas: Record<string, number>;
  principiosMesclados: number;
}

interface Estatistica {
  textos: Map<string, number>;
  ativos: Set<number>;
  todos: Set<number>;
  suspeitas: Set<string>;
  completo: boolean;
  exemplos: string[];
}

type Resolucao =
  | {
      tipo: 'ddinter';
      ids: number[];
      status: 'automatico' | 'confirmado';
      motivo: string;
      nomePt: string;
      moiety: string;
      nomePtDecidido: boolean;
    }
  | {
      tipo: 'pt';
      status: 'confirmado';
      motivo: string;
      nomePt: string;
      moiety: string;
      nomePtDecidido: boolean;
    }
  | { tipo: 'pendente'; motivo: string; candidatos: Candidato[] };

const maisFrequente = (m: Map<string, number>): string =>
  [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt'))[0]?.[0] ?? '';

const slugDe = (nome: string): string =>
  chaveDe(nome)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'principio';

/**
 * Mapeia os componentes do texto de princípio ativo da ANVISA para princípios ativos canônicos,
 * ligados aos medicamentos do DDInter. Função pura: não lê arquivos nem relógio, e a mesma entrada
 * dá a mesma saída. Regras (ADR 0006):
 * - decisão humana > mapeamento automático > pendente;
 * - automático só com nome em inglês IDÊNTICO (depois das regras de grafia) a um único
 *   medicamento do DDInter, sem suspeita de mais de um componente, concentração ou texto cortado;
 * - pendente nunca vira princípio ativo: o medicamento fica com componente pendente, e o motor
 *   (P10) mostra "não verificado" em vez de "nenhuma ocorrência".
 */
export function mapear(entrada: EntradaMapeamento): SaidaMapeamento {
  const limite = entrada.limiteTruncamento ?? LIMITE_TRUNCAMENTO;
  const avisos: string[] = [];
  const farmacoPorId = new Map(entrada.farmacos.map((f) => [f.id, f]));
  const indice = new IndiceDeNomes(entrada.farmacos.map((f) => ({ id: f.id, nome: f.nomeEn })));

  // ---- componentes de cada medicamento ----
  const medicamentos = [...entrada.medicamentos].sort((a, b) => a.id - b.id);
  const estat = new Map<string, Estatistica>();
  const componentesDe = new Map<number, ReturnType<typeof separarComponentes>>();
  for (const m of medicamentos) {
    const comps = separarComponentes(m.principioAtivoOriginal, limite);
    componentesDe.set(m.id, comps);
    for (const c of comps) {
      let e = estat.get(c.chave);
      if (e === undefined) {
        e = {
          textos: new Map(),
          ativos: new Set(),
          todos: new Set(),
          suspeitas: new Set(),
          completo: false,
          exemplos: [],
        };
        estat.set(c.chave, e);
      }
      const t = c.texto.toLowerCase();
      e.textos.set(t, (e.textos.get(t) ?? 0) + 1);
      e.todos.add(m.id);
      if (m.ativo) {
        e.ativos.add(m.id);
        if (e.exemplos.length < 3 && !e.exemplos.includes(m.nome)) e.exemplos.push(m.nome);
      }
      for (const s of c.suspeitas) e.suspeitas.add(s);
      if (!c.truncado) e.completo = true;
    }
  }

  // ---- decisões ----
  const decisoes = new Map<string, Decisao>();
  for (const d of entrada.decisoes) {
    if (decisoes.has(d.chave)) throw new ErroMapeamento(`decisão repetida para "${d.chave}"`);
    decisoes.set(d.chave, d);
    if (d.acao === 'equivale') {
      for (const id of d.ddinterIds) {
        if (!farmacoPorId.has(id)) {
          throw new ErroMapeamento(
            `a decisão para "${d.chave}" aponta para o medicamento DDInter ${id}, que não existe nesta base`,
          );
        }
      }
    }
    if (!estat.has(d.chave) && d.acao !== 'mesmo-que') {
      avisos.push(`decisão sem componente correspondente nos dados: "${d.chave}"`);
    }
  }

  const regrasDeSalUsadas: Record<string, number> = {};
  const nomeExibido = (chave: string, estatistica: Estatistica | undefined): string =>
    estatistica === undefined ? chave : maisFrequente(estatistica.textos);

  // ---- resolução de cada componente ----
  const resolvidos = new Map<string, Resolucao>();
  const emCurso = new Set<string>();

  function sugerir(chave: string): Candidato[] {
    const a = variantesEmIngles(removerSal(chave).chave);
    const b = variantesEmIngles(removerSalComoSugestao(chave).chave);
    return indice.parecidos([...new Set([...a, ...b])], 3, 0.5);
  }

  function resolver(chave: string): Resolucao {
    const feito = resolvidos.get(chave);
    if (feito !== undefined) return feito;
    if (emCurso.has(chave)) {
      return { tipo: 'pendente', motivo: 'decisão "mesmo-que" em ciclo', candidatos: [] };
    }
    emCurso.add(chave);
    const e = estat.get(chave);
    const d = decisoes.get(chave);
    const semSal = removerSal(chave);
    const exibido = nomeExibido(chave, e);
    const moiety = semSal.chave;
    const aposSal = nomeSemSal(exibido, semSal);
    let r: Resolucao;
    if (d !== undefined) {
      const quem = `${d.revisadoPor}, ${d.revisadoEm}`;
      const complemento = d.motivo === undefined ? '' : `: ${d.motivo}`;
      if (d.acao === 'equivale') {
        r = {
          tipo: 'ddinter',
          ids: [...new Set(d.ddinterIds)].sort((x, y) => x - y),
          status: 'confirmado',
          motivo: `decisão de ${quem}${complemento}`,
          nomePt: d.nomePt ?? aposSal,
          moiety,
          nomePtDecidido: d.nomePt !== undefined,
        };
      } else if (d.acao === 'sem-equivalente') {
        r = {
          tipo: 'pt',
          status: 'confirmado',
          motivo: `sem equivalente no DDInter, decisão de ${quem}${complemento}`,
          nomePt: d.nomePt ?? aposSal,
          moiety: d.nomePt === undefined ? moiety : chaveDe(d.nomePt),
          nomePtDecidido: d.nomePt !== undefined,
        };
      } else {
        const alvo = resolver(d.comoChave);
        if (alvo.tipo === 'pendente') {
          avisos.push(
            `decisão "mesmo-que" de "${chave}" aponta para "${d.comoChave}", que está pendente`,
          );
          r = {
            tipo: 'pendente',
            motivo: `decisão "mesmo-que ${d.comoChave}" não vale: o alvo está pendente`,
            candidatos: [],
          };
        } else {
          r = {
            ...alvo,
            status: 'confirmado',
            motivo: `mesmo que "${d.comoChave}", decisão de ${quem}${complemento}`,
            nomePtDecidido: false,
          } as Resolucao;
        }
      }
    } else if (e === undefined) {
      r = { tipo: 'pendente', motivo: 'componente não aparece nos dados', candidatos: [] };
    } else {
      const suspeitas = [...e.suspeitas].sort();
      if (!e.completo) suspeitas.push('só aparece cortado pela ANVISA (texto de 380 caracteres)');
      const variantes = variantesEmIngles(moiety);
      const ids = indice.exatos(variantes);
      if (suspeitas.length > 0) {
        r = {
          tipo: 'pendente',
          motivo: `revisão obrigatória: ${suspeitas.join('; ')}`,
          candidatos: sugerir(chave),
        };
      } else if (ids.length === 1) {
        const id = ids[0] as number;
        const regras = semSal.regras.length > 0 ? ` (tirado: ${semSal.regras.join(', ')})` : '';
        for (const reg of semSal.regras) regrasDeSalUsadas[reg] = (regrasDeSalUsadas[reg] ?? 0) + 1;
        r = {
          tipo: 'ddinter',
          ids: [id],
          status: 'automatico',
          motivo: `automático: grafia igual a "${farmacoPorId.get(id)?.nomeEn}" (DDInter ${id})${regras}`,
          nomePt: aposSal,
          moiety,
          nomePtDecidido: false,
        };
      } else if (ids.length > 1) {
        r = {
          tipo: 'pendente',
          motivo: `ambíguo: ${ids.length} medicamentos do DDInter com essa grafia (${ids.join(', ')})`,
          candidatos: ids
            .slice(0, 3)
            .map((id) => ({ id, nome: farmacoPorId.get(id)?.nomeEn ?? '', similaridade: 1 })),
        };
      } else {
        r = {
          tipo: 'pendente',
          motivo: 'sem correspondência exata no DDInter',
          candidatos: sugerir(chave),
        };
      }
    }
    emCurso.delete(chave);
    resolvidos.set(chave, r);
    return r;
  }

  const chaves = [...new Set([...estat.keys()])].sort();
  for (const c of chaves) resolver(c);
  for (const c of [...decisoes.keys()].sort()) resolver(c);

  // ---- princípios: une os que apontam para o mesmo medicamento do DDInter ----
  const pai = new Map<number, number>();
  const raiz = (x: number): number => {
    let r = x;
    while ((pai.get(r) ?? r) !== r) r = pai.get(r) as number;
    pai.set(x, r);
    return r;
  };
  for (const r of resolvidos.values()) {
    if (r.tipo !== 'ddinter') continue;
    for (const id of r.ids) if (!pai.has(id)) pai.set(id, id);
    for (const id of r.ids.slice(1)) {
      const a = raiz(r.ids[0] as number);
      const b = raiz(id);
      if (a !== b) pai.set(Math.max(a, b), Math.min(a, b));
    }
  }
  // sem-equivalente de um componente cujo princípio já existe pelo DDInter vira o mesmo princípio
  const moietyDoDdinter = new Map<string, string>();
  for (const [, r] of [...resolvidos.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (r.tipo === 'ddinter') {
      const t = `d:${raiz(r.ids[0] as number)}`;
      if (!moietyDoDdinter.has(r.moiety)) moietyDoDdinter.set(r.moiety, t);
    }
  }
  let principiosMesclados = 0;
  const tokenDe = (r: Resolucao): string | null => {
    if (r.tipo === 'pendente') return null;
    if (r.tipo === 'ddinter') return `d:${raiz(r.ids[0] as number)}`;
    const existente = moietyDoDdinter.get(r.moiety);
    if (existente !== undefined) return existente;
    return `p:${r.moiety}`;
  };

  interface GrupoPrincipio {
    token: string;
    chaves: string[];
    votos: Map<string, number>;
    decidido: string | null;
    ddinterIds: Set<number>;
  }
  const grupos = new Map<string, GrupoPrincipio>();
  for (const chave of [...resolvidos.keys()].sort()) {
    const r = resolvidos.get(chave) as Resolucao;
    const token = tokenDe(r);
    if (token === null || r.tipo === 'pendente') continue;
    if (r.tipo === 'pt' && token.startsWith('d:')) principiosMesclados++;
    let g = grupos.get(token);
    if (g === undefined) {
      g = { token, chaves: [], votos: new Map(), decidido: null, ddinterIds: new Set() };
      grupos.set(token, g);
    }
    g.chaves.push(chave);
    const peso = estat.get(chave)?.todos.size ?? 0;
    g.votos.set(r.nomePt, (g.votos.get(r.nomePt) ?? 0) + peso);
    if (r.nomePtDecidido && g.decidido === null) g.decidido = r.nomePt;
    if (r.tipo === 'ddinter') for (const id of r.ids) g.ddinterIds.add(id);
  }

  const slugs = new Map<string, string>();
  const usados = new Set<string>();
  const principios: PrincipioSaida[] = [];
  const nomes: NomeSaida[] = [];
  const vistosNome = new Set<string>();
  const adicionarNome = (n: NomeSaida): void => {
    const k = `${n.slug}|${n.idioma}|${n.nome}`;
    if (vistosNome.has(k)) return;
    vistosNome.add(k);
    nomes.push(n);
  };
  const ordemGrupos = [...grupos.values()].sort((a, b) => {
    const na = a.decidido ?? maisFrequente(a.votos);
    const nb = b.decidido ?? maisFrequente(b.votos);
    return slugDe(na).localeCompare(slugDe(nb)) || a.token.localeCompare(b.token);
  });
  for (const g of ordemGrupos) {
    const nomePt = g.decidido ?? maisFrequente(g.votos);
    const base = slugDe(nomePt);
    let slug = base;
    for (let n = 2; usados.has(slug); n++) slug = `${base}-${n}`;
    if (slug !== base) {
      avisos.push(
        `nome de princípio ativo repetido: "${nomePt}" (${g.token}); possível duplicidade`,
      );
    }
    usados.add(slug);
    slugs.set(g.token, slug);
    const ids = [...g.ddinterIds].sort((a, b) => a - b);
    const nomeEn = ids.length > 0 ? (farmacoPorId.get(ids[0] as number)?.nomeEn ?? null) : null;
    principios.push({ slug, nomePt, nomeEn, ddinterIds: ids });
    adicionarNome({
      slug,
      idioma: 'pt',
      nome: nomePt,
      fonte: g.decidido !== null ? 'decisao' : 'anvisa',
    });
    for (const n of [...g.votos.keys()].sort()) {
      adicionarNome({ slug, idioma: 'pt', nome: n, fonte: 'anvisa' });
    }
    for (const id of ids) {
      const f = farmacoPorId.get(id);
      if (f !== undefined) adicionarNome({ slug, idioma: 'en', nome: f.nomeEn, fonte: 'ddinter' });
    }
  }
  const slugDaChave = (chave: string): string | null => {
    const r = resolvidos.get(chave);
    if (r === undefined) return null;
    const t = tokenDe(r);
    return t === null ? null : (slugs.get(t) ?? null);
  };

  // ---- mapeamento (tabela) ----
  const mapeamentos: MapeamentoSaida[] = [];
  for (const chave of chaves) {
    const r = resolvidos.get(chave) as Resolucao;
    mapeamentos.push({
      origem: 'anvisa-componente',
      chaveOrigem: chave,
      slug: slugDaChave(chave),
      status: r.tipo === 'pendente' ? 'pendente' : r.status,
      motivo: r.motivo,
    });
  }
  const ligadosDdinter = new Map<
    number,
    { status: StatusMapeamento; chaves: string[]; slug: string }
  >();
  for (const chave of [...resolvidos.keys()].sort()) {
    const r = resolvidos.get(chave) as Resolucao;
    if (r.tipo !== 'ddinter') continue;
    for (const id of r.ids) {
      const a = ligadosDdinter.get(id);
      const slug = slugDaChave(chave) as string;
      if (a === undefined) ligadosDdinter.set(id, { status: r.status, chaves: [chave], slug });
      else {
        a.chaves.push(chave);
        if (r.status === 'confirmado') a.status = 'confirmado';
      }
    }
  }
  for (const [id, a] of [...ligadosDdinter.entries()].sort(([x], [y]) => x - y)) {
    mapeamentos.push({
      origem: 'ddinter-farmaco',
      chaveOrigem: String(id),
      slug: a.slug,
      status: a.status,
      motivo: `via ${a.chaves.slice(0, 3).join('; ')}${a.chaves.length > 3 ? ` e mais ${a.chaves.length - 3}` : ''}`,
    });
  }

  // ---- ligações medicamento × princípio ----
  const ligacoes: LigacaoSaida[] = [];
  const porMedicamento: MedicamentoSaida[] = [];
  const pendentesDoAtivo = new Map<number, string[]>();
  for (const m of medicamentos) {
    const comps = componentesDe.get(m.id) ?? [];
    let pendentes = 0;
    let truncado = false;
    const chavesPendentes: string[] = [];
    for (const c of comps) {
      const slug = c.truncado ? null : slugDaChave(c.chave);
      if (c.truncado) {
        truncado = true;
        pendentes++;
        chavesPendentes.push('\0truncado');
      } else if (slug === null) {
        pendentes++;
        chavesPendentes.push(c.chave);
      } else {
        ligacoes.push({ medicamentoId: m.id, ordem: c.ordem, slug });
      }
    }
    porMedicamento.push({ medicamentoId: m.id, componentes: comps.length, pendentes, truncado });
    if (m.ativo && pendentes > 0) pendentesDoAtivo.set(m.id, chavesPendentes);
  }

  // ---- fila de revisão ----
  const fila: ItemFila[] = chaves
    .filter((c) => resolvidos.get(c)?.tipo === 'pendente')
    .map((c) => {
      const e = estat.get(c) as Estatistica;
      const r = resolvidos.get(c) as Extract<Resolucao, { tipo: 'pendente' }>;
      return {
        posicao: 0,
        chave: c,
        textoExemplo: maisFrequente(e.textos),
        medicamentosAtivos: e.ativos.size,
        medicamentosTotal: e.todos.size,
        motivo: r.motivo,
        candidatos: r.candidatos,
        exemplos: e.exemplos,
      };
    })
    .sort(
      (a, b) =>
        b.medicamentosAtivos - a.medicamentosAtivos ||
        b.medicamentosTotal - a.medicamentosTotal ||
        a.chave.localeCompare(b.chave),
    );
  fila.forEach((f, i) => (f.posicao = i + 1));
  const posicaoNaFila = new Map(fila.map((f) => [f.chave, f.posicao]));

  const automaticos: ItemAutomatico[] = chaves
    .filter((c) => {
      const r = resolvidos.get(c);
      return r?.tipo === 'ddinter' && r.status === 'automatico';
    })
    .map((c) => {
      const e = estat.get(c) as Estatistica;
      const r = resolvidos.get(c) as Extract<Resolucao, { tipo: 'ddinter' }>;
      return {
        chave: c,
        textoExemplo: maisFrequente(e.textos),
        medicamentosAtivos: e.ativos.size,
        ddinterIds: r.ids,
        nomesEn: r.ids.map((id) => farmacoPorId.get(id)?.nomeEn ?? ''),
        motivo: r.motivo,
      };
    })
    .sort((a, b) => b.medicamentosAtivos - a.medicamentosAtivos || a.chave.localeCompare(b.chave));

  // ---- cobertura ----
  const ativos = medicamentos.filter((m) => m.ativo);
  const saidaDe = new Map(porMedicamento.map((m) => [m.medicamentoId, m]));
  const comTexto = ativos.filter((m) => (saidaDe.get(m.id)?.componentes ?? 0) > 0);
  const completos = comTexto.filter((m) => saidaDe.get(m.id)?.pendentes === 0).length;
  const nenhum = comTexto.filter((m) => {
    const s = saidaDe.get(m.id) as MedicamentoSaida;
    return s.pendentes === s.componentes;
  }).length;
  const cortados = comTexto.filter((m) => saidaDe.get(m.id)?.truncado === true).length;
  const pct = (n: number, d: number): number => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);
  // marcos da fila (10, 25, 50...) que existem, mais a fila inteira
  const marcos = [
    ...[10, 25, 50, 100, 250, 500, 1000, 2500].filter((n) => n < fila.length),
    fila.length,
  ].filter((n) => n > 0);
  const seResolvidos = marcos.map((n) => {
    let ganho = 0;
    for (const chavesPend of pendentesDoAtivo.values()) {
      if (chavesPend.includes('\0truncado')) continue;
      if (chavesPend.every((c) => (posicaoNaFila.get(c) ?? Infinity) <= n)) ganho++;
    }
    return { primeiros: n, percentual: pct(completos + ganho, comTexto.length) };
  });
  const status = (s: StatusMapeamento): number =>
    mapeamentos.filter((m) => m.origem === 'anvisa-componente' && m.status === s).length;
  const cobertura: Cobertura = {
    medicamentos: {
      total: medicamentos.length,
      ativos: ativos.length,
      ativosSemPrincipio: ativos.length - comTexto.length,
      ativosComTexto: comTexto.length,
    },
    ativos: {
      completos,
      parciais: comTexto.length - completos - nenhum,
      nenhumMapeado: nenhum,
      comTextoCortado: cortados,
    },
    percentualCompletos: pct(completos, comTexto.length),
    componentes: {
      distintos: chaves.length,
      automatico: status('automatico'),
      confirmado: status('confirmado'),
      pendente: status('pendente'),
    },
    principios: principios.length,
    farmacosLigados: ligadosDdinter.size,
    seResolvidos,
  };

  // ---- conjunto de referência ----
  const principioPorNome = new Map<string, string>();
  for (const n of nomes) {
    if (n.idioma === 'pt') principioPorNome.set(chaveDe(n.nome), n.slug);
  }
  const statusDoPrincipio = (slug: string): StatusMapeamento => {
    const doGrupo = mapeamentos.filter((m) => m.origem === 'anvisa-componente' && m.slug === slug);
    return doGrupo.some((m) => m.status === 'confirmado') ? 'confirmado' : 'automatico';
  };
  const referencia: SituacaoReferencia[] = (entrada.referencia ?? []).map((r) => {
    const chave = chaveDe(r.nome);
    const direta = resolvidos.get(chave);
    if (direta !== undefined) {
      const slug = slugDaChave(chave);
      return {
        id: r.id,
        nome: r.nome,
        situacao: direta.tipo === 'pendente' ? 'pendente' : direta.status,
        slug,
      };
    }
    const slug = principioPorNome.get(chave) ?? principioPorNome.get(removerSal(chave).chave);
    if (slug !== undefined) {
      return { id: r.id, nome: r.nome, situacao: statusDoPrincipio(slug), slug };
    }
    return { id: r.id, nome: r.nome, situacao: 'nao-encontrado', slug: null };
  });

  return {
    principios,
    nomes,
    mapeamentos,
    ligacoes,
    medicamentos: porMedicamento,
    fila,
    automaticos,
    cobertura,
    referencia,
    avisos,
    regrasDeSalUsadas: Object.fromEntries(
      Object.entries(regrasDeSalUsadas).sort(([a], [b]) => a.localeCompare(b)),
    ),
    principiosMesclados,
  };
}
