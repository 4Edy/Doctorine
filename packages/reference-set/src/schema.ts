import { z } from 'zod';

/**
 * Gravidades padronizadas (escala aprovada na Fase 0). A classificação original de cada fonte
 * é guardada à parte no modelo de dados (Fase 2); aqui só importa o resultado
 * esperado pela farmacêutica.
 */
export const GRAVIDADES = ['contraindicada', 'grave', 'moderada', 'leve'] as const;
export type Gravidade = (typeof GRAVIDADES)[number];

export const TIPOS_PAR = [
  'medicamento-medicamento',
  'medicamento-alimento',
  'medicamento-doenca',
  'duplicidade',
  'sem-interacao',
] as const;
export type TipoPar = (typeof TIPOS_PAR)[number];

const dataIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'use o formato AAAA-MM-DD')
  .refine((valor) => {
    const data = new Date(`${valor}T00:00:00Z`);
    return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === valor;
  }, 'data inexistente');

const nome = z.string().trim().min(2, 'nome muito curto');

const principioAtivo = z.strictObject({
  tipo: z.literal('principio_ativo'),
  nome,
  atc: z
    .string()
    .regex(/^[A-Z]\d{2}[A-Z]{2}\d{2}$/, 'código ATC inválido (ex.: N02BE01)')
    .optional(),
});

const alimento = z.strictObject({ tipo: z.literal('alimento'), nome });
const doenca = z.strictObject({ tipo: z.literal('doenca'), nome });

export const itemSchema = z.discriminatedUnion('tipo', [principioAtivo, alimento, doenca]);
export type Item = z.infer<typeof itemSchema>;

const fonte = z.strictObject({
  nome,
  referencia: z.string().trim().min(3, 'informe a referência (endereço ou citação)'),
  consultadoEm: dataIso,
});

const revisao = z.strictObject({
  revisadoPor: nome,
  revisadoEm: dataIso,
});

const esperado = z.strictObject({
  ocorrencia: z.boolean(),
  gravidade: z.enum(GRAVIDADES).optional(),
});

/** Tipo esperado para o segundo item de cada tipo de par. */
const SEGUNDO_ITEM: Record<TipoPar, Item['tipo']> = {
  'medicamento-medicamento': 'principio_ativo',
  'medicamento-alimento': 'alimento',
  'medicamento-doenca': 'doenca',
  duplicidade: 'principio_ativo',
  'sem-interacao': 'principio_ativo',
};

export const parSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'use minúsculas, números e hífens'),
    tipo: z.enum(TIPOS_PAR),
    a: itemSchema,
    b: itemSchema,
    esperado,
    fonte,
    /** null = ainda não revisado pela farmacêutica. */
    revisao: revisao.nullable(),
    observacao: z.string().trim().min(1).optional(),
  })
  .superRefine((par, ctx) => {
    if (par.a.tipo !== 'principio_ativo') {
      ctx.addIssue({
        code: 'custom',
        path: ['a', 'tipo'],
        message: 'o primeiro item sempre é um princípio ativo',
      });
    }

    const esperadoB = SEGUNDO_ITEM[par.tipo];
    if (par.b.tipo !== esperadoB) {
      ctx.addIssue({
        code: 'custom',
        path: ['b', 'tipo'],
        message: `para "${par.tipo}" o segundo item deve ser do tipo "${esperadoB}"`,
      });
    }

    const { ocorrencia, gravidade } = par.esperado;
    if (par.tipo === 'sem-interacao') {
      if (ocorrencia) {
        ctx.addIssue({
          code: 'custom',
          path: ['esperado', 'ocorrencia'],
          message: '"sem-interacao" exige ocorrencia = false',
        });
      }
      if (gravidade !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['esperado', 'gravidade'],
          message: '"sem-interacao" não tem gravidade',
        });
      }
      return;
    }

    if (!ocorrencia) {
      ctx.addIssue({
        code: 'custom',
        path: ['esperado', 'ocorrencia'],
        message: `"${par.tipo}" exige ocorrencia = true (use "sem-interacao" para ausência)`,
      });
    }
    if (par.tipo !== 'duplicidade' && gravidade === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['esperado', 'gravidade'],
        message: `"${par.tipo}" exige gravidade`,
      });
    }
  });
export type Par = z.infer<typeof parSchema>;

export const arquivoSchema = z.strictObject({
  versao: z.literal(1),
  pares: z.array(parSchema),
});
export type Arquivo = z.infer<typeof arquivoSchema>;
