import { createHash } from 'node:crypto';

export type Nivel = 'Major' | 'Moderate' | 'Minor' | 'Unknown';
export type TipoTexto =
  | 'interacao'
  | 'manejo'
  | 'alimento-mecanismo'
  | 'alimento-interacao'
  | 'alimento-manejo'
  | 'doenca';

export interface Uso {
  tipo: TipoTexto;
  /** Identificador de origem: `texto:9`, `alimento:12`, `doenca:7`. */
  chave: string;
  nivel: Nivel;
}
/** Um texto distinto em inglês, traduzido uma só vez, com todos os lugares onde é usado. */
export interface UnidadeTexto {
  /** 16 primeiros caracteres do SHA-256 do texto normalizado. Muda se o inglês mudar. */
  id: string;
  en: string;
  usos: Uso[];
  /** 0 = Major ... 3 = Unknown; o mais grave entre os usos. Define a ordem da revisão. */
  prioridade: number;
}

export interface EntradaTextos {
  textos: ReadonlyArray<{ id: number; nivel: Nivel; texto: string | null }>;
  manejo: ReadonlyArray<{ idTexto: number; interacao: string | null; manejo: string | null }>;
  alimentos: ReadonlyArray<{
    id: number;
    nivel: Nivel;
    mecanismo: string | null;
    interacao: string;
    manejo: string;
  }>;
  doencas: ReadonlyArray<{ id: number; nivel: Nivel; texto: string }>;
}

const PRIORIDADE: Record<Nivel, number> = { Major: 0, Moderate: 1, Minor: 2, Unknown: 3 };
export const NOMES_PRIORIDADE = ['Major', 'Moderate', 'Minor', 'Unknown'] as const;

export const normalizarTexto = (s: string): string => s.replace(/\s+/g, ' ').trim();
export const idDoTexto = (normalizado: string): string =>
  createHash('sha256').update(normalizado, 'utf8').digest('hex').slice(0, 16);

/**
 * Junta todos os textos clínicos do DDInter em unidades distintas. Texto igual em lugares
 * diferentes (muito comum no manejo) vira uma unidade só. Ordem: mais grave primeiro, depois id,
 * para a revisão e o rascunho seguirem a gravidade.
 */
export function extrairUnidades(e: EntradaTextos): UnidadeTexto[] {
  const porId = new Map<string, UnidadeTexto>();
  const adicionar = (texto: string | null, uso: Uso): void => {
    if (texto === null) return;
    const en = normalizarTexto(texto);
    if (en === '') return;
    const id = idDoTexto(en);
    let u = porId.get(id);
    if (u === undefined) {
      u = { id, en, usos: [], prioridade: 3 };
      porId.set(id, u);
    }
    if (!u.usos.some((x) => x.tipo === uso.tipo && x.chave === uso.chave)) u.usos.push(uso);
    u.prioridade = Math.min(u.prioridade, PRIORIDADE[uso.nivel]);
  };

  const nivelDoTexto = new Map(e.textos.map((t) => [t.id, t.nivel]));
  const textoDaExportacao = new Map(e.textos.map((t) => [t.id, t.texto]));
  for (const t of e.textos) {
    adicionar(t.texto, { tipo: 'interacao', chave: `texto:${t.id}`, nivel: t.nivel });
  }
  for (const m of e.manejo) {
    const nivel = nivelDoTexto.get(m.idTexto) ?? 'Unknown';
    // a descrição da página só entra quando a exportação não tem o texto
    if (textoDaExportacao.get(m.idTexto) == null) {
      adicionar(m.interacao, { tipo: 'interacao', chave: `texto:${m.idTexto}`, nivel });
    }
    adicionar(m.manejo, { tipo: 'manejo', chave: `texto:${m.idTexto}`, nivel });
  }
  for (const a of e.alimentos) {
    const chave = `alimento:${a.id}`;
    adicionar(a.mecanismo, { tipo: 'alimento-mecanismo', chave, nivel: a.nivel });
    adicionar(a.interacao, { tipo: 'alimento-interacao', chave, nivel: a.nivel });
    adicionar(a.manejo, { tipo: 'alimento-manejo', chave, nivel: a.nivel });
  }
  for (const d of e.doencas) {
    adicionar(d.texto, { tipo: 'doenca', chave: `doenca:${d.id}`, nivel: d.nivel });
  }

  return [...porId.values()].sort(
    (a, b) => a.prioridade - b.prioridade || a.id.localeCompare(b.id),
  );
}

/** Versão do conjunto de unidades: depende só dos ids (portanto, só do inglês). */
export function versaoDasUnidades(unidades: readonly UnidadeTexto[]): string {
  const h = createHash('sha256');
  for (const u of [...unidades].sort((a, b) => a.id.localeCompare(b.id))) h.update(u.id + '\n');
  return h.digest('hex').slice(0, 12);
}
