import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { ErroTraducao } from './erro.js';

/**
 * Memória de tradução: um registro por texto (id do inglês), guardado como uma sequência de eventos
 * que só cresce. O estado de um texto é o último evento; os anteriores são o histórico das versões.
 *
 * Regras de status (testadas):
 * - o rascunho por IA sempre entra como `nao-revisado`;
 * - `revisado` e `corrigido` só vêm de uma pessoa (`origem: "humano"`);
 * - um rascunho novo nunca sobrescreve texto já revisado ou corrigido;
 * - `corrigido` é uma tradução diferente da anterior; aprovar sem mudar é `revisado`.
 */
export const STATUS = ['nao-revisado', 'revisado', 'corrigido'] as const;
export type Status = (typeof STATUS)[number];

export const esquemaEvento = z.object({
  id: z.string().regex(/^[0-9a-f]{16}$/),
  seq: z.number().int().positive(),
  pt: z.string().min(1),
  status: z.enum(STATUS),
  origem: z.enum(['ia', 'humano']),
  /** Modelo que gerou o rascunho (ou "manual"); nulo em revisão humana. */
  modelo: z.string().nullable(),
  /** Identificador do glossário vigente quando o evento foi gravado. */
  glossario: z.string(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  nota: z.string().nullable().default(null),
});
export type Evento = z.infer<typeof esquemaEvento>;

export class Memoria {
  private readonly eventos: Evento[] = [];
  private readonly ultimo = new Map<string, Evento>();
  private pendentes: Evento[] = [];

  constructor(readonly caminho: string) {
    if (!existsSync(caminho)) return;
    for (const [i, linha] of readFileSync(caminho, 'utf8').split('\n').entries()) {
      if (linha.trim() === '') continue;
      let bruto: unknown;
      try {
        bruto = JSON.parse(linha);
      } catch {
        throw new ErroTraducao(`${caminho}, linha ${i + 1}: JSON inválido`);
      }
      const r = esquemaEvento.safeParse(bruto);
      if (!r.success) {
        throw new ErroTraducao(`${caminho}, linha ${i + 1}: ${r.error.issues[0]?.message}`);
      }
      this.aplicar(r.data, `${caminho}, linha ${i + 1}`);
    }
    this.pendentes = [];
  }

  private aplicar(e: Evento, onde: string): void {
    const anterior = this.ultimo.get(e.id);
    if (e.seq !== (anterior?.seq ?? 0) + 1) {
      throw new ErroTraducao(`${onde}: sequência ${e.seq} fora de ordem para o texto ${e.id}`);
    }
    if (e.origem === 'ia' && e.status !== 'nao-revisado') {
      throw new ErroTraducao(`${onde}: texto de IA não pode ter status ${e.status}`);
    }
    if (e.origem === 'humano' && e.status === 'nao-revisado') {
      throw new ErroTraducao(`${onde}: revisão humana não pode voltar a nao-revisado`);
    }
    this.eventos.push(e);
    this.ultimo.set(e.id, e);
    this.pendentes.push(e);
  }

  estado(id: string): Evento | undefined {
    return this.ultimo.get(id);
  }
  get tamanho(): number {
    return this.ultimo.size;
  }
  historico(id: string): Evento[] {
    return this.eventos.filter((e) => e.id === id);
  }
  todos(): IterableIterator<Evento> {
    return this.ultimo.values();
  }

  /** Grava um rascunho por IA. Recusa se já houver texto revisado ou corrigido. */
  registrarRascunho(
    id: string,
    pt: string,
    meta: { modelo: string; glossario: string; data: string },
  ): Evento {
    const atual = this.ultimo.get(id);
    if (atual !== undefined && atual.status !== 'nao-revisado') {
      throw new ErroTraducao(`texto ${id} já está ${atual.status}; o rascunho não o sobrescreve`);
    }
    return this.novo(
      id,
      atual,
      { pt, status: 'nao-revisado', origem: 'ia', modelo: meta.modelo },
      meta,
    );
  }

  /** Revisão humana: a tradução está certa como está. */
  aprovar(id: string, meta: { glossario: string; data: string; nota?: string }): Evento {
    const atual = this.exigir(id);
    return this.novo(
      id,
      atual,
      { pt: atual.pt, status: 'revisado', origem: 'humano', modelo: null },
      meta,
    );
  }

  /** Revisão humana: a tradução foi corrigida. Texto igual ao atual é só aprovação. */
  corrigir(
    id: string,
    pt: string,
    meta: { glossario: string; data: string; nota?: string },
  ): Evento {
    const atual = this.exigir(id);
    if (pt.trim() === atual.pt.trim()) return this.aprovar(id, meta);
    return this.novo(id, atual, { pt, status: 'corrigido', origem: 'humano', modelo: null }, meta);
  }

  private exigir(id: string): Evento {
    const atual = this.ultimo.get(id);
    if (atual === undefined)
      throw new ErroTraducao(`texto ${id} ainda não tem tradução para revisar`);
    return atual;
  }

  private novo(
    id: string,
    anterior: Evento | undefined,
    c: Pick<Evento, 'pt' | 'status' | 'origem' | 'modelo'>,
    meta: { glossario: string; data: string; nota?: string },
  ): Evento {
    const e: Evento = {
      id,
      seq: (anterior?.seq ?? 0) + 1,
      ...c,
      glossario: meta.glossario,
      data: meta.data,
      nota: meta.nota ?? null,
    };
    this.aplicar(e, `texto ${id}`);
    return e;
  }

  /** Acrescenta ao arquivo só o que é novo desde a leitura ou a última gravação. */
  gravar(): number {
    if (this.pendentes.length === 0) return 0;
    mkdirSync(dirname(this.caminho), { recursive: true });
    appendFileSync(this.caminho, this.pendentes.map((e) => JSON.stringify(e)).join('\n') + '\n');
    const n = this.pendentes.length;
    this.pendentes = [];
    return n;
  }
}
