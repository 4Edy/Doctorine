import { z } from 'zod';

/** Cabeçalho dos arquivos `ddinter_downloads_code_*.csv`, na ordem do arquivo (baixados em 2026-11-12). */
export const COLUNAS = ['DDInterID_A', 'Drug_A', 'DDInterID_B', 'Drug_B', 'Level'] as const;
export type Coluna = (typeof COLUNAS)[number];

/** Classificação original do DDInter, como vem no arquivo. A conversão para a escala do Doctorine é da Fase 2. */
export const NIVEIS = ['Major', 'Moderate', 'Minor', 'Unknown'] as const;
export type Nivel = (typeof NIVEIS)[number];

/** Para escolher o nível mais grave quando o mesmo par aparece com níveis diferentes. */
export const ORDEM_GRAVIDADE: Record<Nivel, number> = {
  Major: 3,
  Moderate: 2,
  Minor: 1,
  Unknown: 0,
};

/**
 * O DDInter publica os downloads em 8 arquivos, um por letra (A, B, D, H, L, P, R, V). Todos são
 * exigidos: processar com arquivo faltando reduziria a cobertura sem aviso.
 */
export const LETRAS_ESPERADAS = ['A', 'B', 'D', 'H', 'L', 'P', 'R', 'V'] as const;

export const nomeArquivo = (letra: string): string => `ddinter_downloads_code_${letra}.csv`;

/** Reconhece o arquivo mesmo com prefixo (por exemplo, "68dedba5-ddinter_downloads_code_B.csv"). */
export const letraDoArquivo = (nome: string): string | null =>
  /ddinter_downloads_code_([A-Z])\.csv$/.exec(nome)?.[1] ?? null;

export interface InteracaoLinha {
  idA: string;
  nomeA: string;
  idB: string;
  nomeB: string;
  nivel: Nivel;
}

const id = z.string().regex(/^DDInter\d+$/, 'identificador fora do formato DDInter<número>');
const nome = z
  .string()
  .min(1, 'nome vazio')
  .refine((v) => v === v.trim(), 'nome com espaço no começo ou no fim');

const linhaSchema = z
  .object({
    DDInterID_A: id,
    Drug_A: nome,
    DDInterID_B: id,
    Drug_B: nome,
    Level: z.enum(NIVEIS, {
      error: 'nível desconhecido (esperado Major, Moderate, Minor ou Unknown)',
    }),
  })
  .refine((v) => v.DDInterID_A !== v.DDInterID_B, {
    path: ['DDInterID_B'],
    message: 'o medicamento interage consigo mesmo (mesmo identificador nos dois lados)',
  });

export type ResultadoLinha =
  { ok: true; valor: InteracaoLinha } | { ok: false; motivos: string[]; colunas: string[] };

export function validarLinha(campos: readonly string[]): ResultadoLinha {
  const r = linhaSchema.safeParse(Object.fromEntries(COLUNAS.map((c, i) => [c, campos[i]])));
  if (r.success) {
    const v = r.data;
    return {
      ok: true,
      valor: {
        idA: v.DDInterID_A,
        nomeA: v.Drug_A,
        idB: v.DDInterID_B,
        nomeB: v.Drug_B,
        nivel: v.Level,
      },
    };
  }
  const colunas = r.error.issues.map((i) => String(i.path[0] ?? '(linha)'));
  const motivos = r.error.issues.map((i) => `${String(i.path[0] ?? '(linha)')}: ${i.message}`);
  return { ok: false, motivos, colunas };
}

/** Devolve o motivo se o cabeçalho for diferente do esperado; null se estiver certo. */
export function conferirCabecalho(campos: readonly string[]): string | null {
  const iguais = campos.length === COLUNAS.length && COLUNAS.every((c, i) => campos[i] === c);
  return iguais
    ? null
    : `cabeçalho diferente do esperado: esperado "${COLUNAS.join(',')}", encontrado "${campos.join(',')}"`;
}
