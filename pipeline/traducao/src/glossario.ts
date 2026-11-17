import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { ErroTraducao } from './erro.js';

/**
 * Glossário de termos farmacológicos. `status` diz se a farmacêutica já aprovou o termo
 * (`aprovado`) ou se ainda é proposta (`proposto`). Termo proposto gera aviso quando a tradução
 * não o usa; termo aprovado gera erro.
 */
export const entradaGlossario = z.object({
  en: z.string().min(2),
  /** Outras grafias em inglês que valem como o mesmo termo (por exemplo, sem hífen). */
  variantesEn: z.array(z.string().min(2)).default([]),
  pt: z.string().min(2),
  /** Outras formas em português aceitas (gênero, plural irregular, sinônimo). */
  aceitas: z.array(z.string().min(2)).default([]),
  status: z.enum(['proposto', 'aprovado']),
  nota: z.string().optional(),
});
export const esquemaGlossario = z.object({
  versao: z.number().int().positive(),
  termos: z.array(entradaGlossario),
});
export type EntradaGlossario = z.infer<typeof entradaGlossario>;
export interface Glossario {
  versao: number;
  /** Hash curto do conteúdo; entra em cada tradução registrada. */
  id: string;
  termos: EntradaGlossario[];
}

export function lerGlossario(caminho: string): Glossario {
  let bruto: unknown;
  try {
    bruto = JSON.parse(readFileSync(caminho, 'utf8'));
  } catch (e) {
    throw new ErroTraducao(`glossário ilegível em ${caminho}: ${(e as Error).message}`);
  }
  return criarGlossario(bruto);
}

export function criarGlossario(bruto: unknown): Glossario {
  const r = esquemaGlossario.safeParse(bruto);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new ErroTraducao(`glossário fora do formato: ${i?.path.join('.')}: ${i?.message}`);
  }
  const vistos = new Map<string, string>();
  for (const t of r.data.termos) {
    for (const forma of [t.en, ...t.variantesEn]) {
      const chave = forma.toLowerCase();
      const outro = vistos.get(chave);
      if (outro !== undefined) {
        throw new ErroTraducao(`glossário: "${forma}" aparece em "${outro}" e em "${t.en}"`);
      }
      vistos.set(chave, t.en);
    }
  }
  const id = createHash('sha256').update(JSON.stringify(r.data)).digest('hex').slice(0, 12);
  return { versao: r.data.versao, id, termos: r.data.termos };
}

const escapar = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SO_MAIUSCULAS = /^[A-Z0-9\-/]+$/;

/** Regex do termo em inglês: palavra inteira, plural em "s" aceito; sigla só em maiúsculas. */
function regexTermo(t: EntradaGlossario): RegExp {
  const formas = [t.en, ...t.variantesEn].map(escapar).join('|');
  const sigla = SO_MAIUSCULAS.test(t.en);
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${formas})s?(?![\\p{L}\\p{N}])`, sigla ? 'u' : 'iu');
}

/** Termos do glossário que aparecem no texto em inglês. */
export function termosNoTexto(en: string, g: Glossario): EntradaGlossario[] {
  return g.termos.filter((t) => regexTermo(t).test(en));
}

/** Termos presentes no inglês cuja tradução (nenhuma forma aceita) não aparece no português. */
export function termosAusentes(en: string, pt: string, g: Glossario): EntradaGlossario[] {
  const baixo = pt.toLowerCase();
  return termosNoTexto(en, g).filter(
    (t) => ![t.pt, ...t.aceitas].some((f) => baixo.includes(f.toLowerCase())),
  );
}
