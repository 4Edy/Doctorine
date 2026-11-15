import { z } from 'zod';
import { chaveDe } from './normalizar.js';

const dataIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'use o formato AAAA-MM-DD')
  .refine((v) => new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v, 'data inexistente');
const quem = z.string().trim().min(2, 'diga quem revisou');

const base = {
  /** Componente do texto da ANVISA, normalizado (minúsculas, sem acento). */
  chave: z.string().min(1),
  revisadoPor: quem,
  revisadoEm: dataIso,
  motivo: z.string().trim().min(1).optional(),
};

/**
 * Decisão humana sobre um componente. Sempre vale mais que o mapeamento automático e sempre
 * resulta em status `confirmado`.
 * - `equivale`: o componente é o(s) medicamento(s) do DDInter listados em `ddinterIds`.
 * - `sem-equivalente`: é um princípio ativo de verdade, que o DDInter não tem (a ausência de
 *   interação é então um fato da fonte, não um erro de mapeamento).
 * - `mesmo-que`: é outra grafia ou sal de `comoChave` e herda o mesmo princípio ativo.
 */
export const decisao = z.discriminatedUnion('acao', [
  z.strictObject({
    ...base,
    acao: z.literal('equivale'),
    ddinterIds: z.array(z.number().int().positive()).min(1),
    nomePt: z.string().trim().min(2).optional(),
  }),
  z.strictObject({
    ...base,
    acao: z.literal('sem-equivalente'),
    nomePt: z.string().trim().min(2).optional(),
  }),
  z.strictObject({ ...base, acao: z.literal('mesmo-que'), comoChave: z.string().min(1) }),
]);
export type Decisao = z.infer<typeof decisao>;

export const arquivoDecisoes = z.strictObject({
  versao: z.literal(1),
  /** Data da última alteração do arquivo; entra na proveniência da base. */
  atualizadoEm: dataIso,
  decisoes: z.array(decisao),
});
export type ArquivoDecisoes = z.infer<typeof arquivoDecisoes>;

export const DECISOES_VAZIAS: ArquivoDecisoes = {
  versao: 1,
  atualizadoEm: '2026-11-14',
  decisoes: [],
};

/** Valida o arquivo e confere o que o esquema sozinho não confere. Devolve os problemas, não lança. */
export function validarDecisoes(
  bruto: unknown,
): { ok: true; dados: ArquivoDecisoes } | { ok: false; problemas: string[] } {
  const r = arquivoDecisoes.safeParse(bruto);
  if (!r.success) {
    return {
      ok: false,
      problemas: r.error.issues.map((i) => `${i.path.join('.') || '(arquivo)'}: ${i.message}`),
    };
  }
  const problemas: string[] = [];
  const vistas = new Set<string>();
  r.data.decisoes.forEach((d, i) => {
    const onde = `decisoes.${i} (${d.chave})`;
    if (d.chave !== chaveDe(d.chave)) problemas.push(`${onde}: a chave precisa estar normalizada`);
    if (vistas.has(d.chave)) problemas.push(`${onde}: chave repetida`);
    vistas.add(d.chave);
    if (d.acao === 'mesmo-que') {
      if (d.comoChave !== chaveDe(d.comoChave))
        problemas.push(`${onde}: comoChave precisa estar normalizada`);
      if (d.comoChave === d.chave) problemas.push(`${onde}: comoChave igual à própria chave`);
    }
  });
  return problemas.length > 0 ? { ok: false, problemas } : { ok: true, dados: r.data };
}
