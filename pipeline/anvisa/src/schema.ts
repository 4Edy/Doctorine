import { z } from 'zod';

/** Colunas de DADOS_ABERTOS_MEDICAMENTOS.csv, na ordem do arquivo (amostra de 2026-11-11). */
export const COLUNAS = [
  'TIPO_PRODUTO',
  'NOME_PRODUTO',
  'DATA_FINALIZACAO_PROCESSO',
  'CATEGORIA_REGULATORIA',
  'NUMERO_REGISTRO_PRODUTO',
  'DATA_VENCIMENTO_REGISTRO',
  'NUMERO_PROCESSO',
  'CLASSE_TERAPEUTICA',
  'EMPRESA_DETENTORA_REGISTRO',
  'SITUACAO_REGISTRO',
  'PRINCIPIO_ATIVO',
] as const;
export type Coluna = (typeof COLUNAS)[number];

export interface Empresa {
  /** 14 dígitos, sem pontuação. null quando o texto não segue "CNPJ - NOME". */
  cnpj: string | null;
  nome: string;
}

export interface RegistroAnvisa {
  tipoProduto: string;
  nomeProduto: string;
  /** AAAA-MM-DD */
  dataFinalizacaoProcesso: string | null;
  categoriaRegulatoria: string | null;
  numeroRegistro: string | null;
  /** AAAA-MM (no arquivo vem como MMAAAA). */
  vencimentoRegistro: string | null;
  numeroProcesso: string | null;
  classeTerapeutica: string | null;
  empresa: Empresa | null;
  situacaoRegistro: string;
  /**
   * Texto original da ANVISA, sem separar. Separar em princípios ativos canônicos é trabalho da
   * Fase 2 (mapeamento), não deste leitor.
   */
  principioAtivo: string | null;
}

/** Campo de RegistroAnvisa que cada coluna do CSV alimenta. */
export const CAMPO_DA_COLUNA: Record<Coluna, keyof RegistroAnvisa> = {
  TIPO_PRODUTO: 'tipoProduto',
  NOME_PRODUTO: 'nomeProduto',
  DATA_FINALIZACAO_PROCESSO: 'dataFinalizacaoProcesso',
  CATEGORIA_REGULATORIA: 'categoriaRegulatoria',
  NUMERO_REGISTRO_PRODUTO: 'numeroRegistro',
  DATA_VENCIMENTO_REGISTRO: 'vencimentoRegistro',
  NUMERO_PROCESSO: 'numeroProcesso',
  CLASSE_TERAPEUTICA: 'classeTerapeutica',
  EMPRESA_DETENTORA_REGISTRO: 'empresa',
  SITUACAO_REGISTRO: 'situacaoRegistro',
  PRINCIPIO_ATIVO: 'principioAtivo',
};

const texto = z.string().trim();
const obrigatorio = texto.min(1, 'campo obrigatório vazio');
const opcional = texto.transform((v) => (v === '' ? null : v));

function falhar(ctx: z.RefinementCtx, input: unknown, message: string): never {
  ctx.issues.push({ code: 'custom', message, input });
  return z.NEVER;
}

const dataBr = opcional.transform((v, ctx) => {
  if (v === null) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  if (m === null) return falhar(ctx, v, `data "${v}" fora do formato DD/MM/AAAA`);
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const data = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== iso) {
    return falhar(ctx, v, `data "${v}" não existe`);
  }
  return iso;
});

const mesAno = opcional.transform((v, ctx) => {
  if (v === null) return null;
  const m = /^(\d{2})(\d{4})$/.exec(v);
  if (m === null || Number(m[1]) < 1 || Number(m[1]) > 12) {
    return falhar(ctx, v, `vencimento "${v}" fora do formato MMAAAA`);
  }
  return `${m[2]}-${m[1]}`;
});

function digitos(rotulo: string) {
  return opcional.transform((v, ctx) => {
    if (v === null) return null;
    if (!/^\d+$/.test(v)) return falhar(ctx, v, `${rotulo} "${v}" não é numérico`);
    return v;
  });
}

const empresa = opcional.transform((v): Empresa | null => {
  if (v === null) return null;
  const m = /^(\d{14})\s+-\s+(.+)$/.exec(v);
  return m === null
    ? { cnpj: null, nome: v }
    : { cnpj: m[1] as string, nome: (m[2] as string).trim() };
});

export const linhaSchema = z
  .strictObject({
    TIPO_PRODUTO: obrigatorio,
    NOME_PRODUTO: obrigatorio,
    DATA_FINALIZACAO_PROCESSO: dataBr,
    CATEGORIA_REGULATORIA: opcional,
    NUMERO_REGISTRO_PRODUTO: digitos('número de registro'),
    DATA_VENCIMENTO_REGISTRO: mesAno,
    NUMERO_PROCESSO: digitos('número de processo'),
    CLASSE_TERAPEUTICA: opcional,
    EMPRESA_DETENTORA_REGISTRO: empresa,
    SITUACAO_REGISTRO: obrigatorio,
    PRINCIPIO_ATIVO: opcional,
  })
  .transform((r): RegistroAnvisa => ({
    tipoProduto: r.TIPO_PRODUTO,
    nomeProduto: r.NOME_PRODUTO,
    dataFinalizacaoProcesso: r.DATA_FINALIZACAO_PROCESSO,
    categoriaRegulatoria: r.CATEGORIA_REGULATORIA,
    numeroRegistro: r.NUMERO_REGISTRO_PRODUTO,
    vencimentoRegistro: r.DATA_VENCIMENTO_REGISTRO,
    numeroProcesso: r.NUMERO_PROCESSO,
    classeTerapeutica: r.CLASSE_TERAPEUTICA,
    empresa: r.EMPRESA_DETENTORA_REGISTRO,
    situacaoRegistro: r.SITUACAO_REGISTRO,
    principioAtivo: r.PRINCIPIO_ATIVO,
  }));

export type ResultadoLinha =
  { ok: true; registro: RegistroAnvisa } | { ok: false; motivos: string[] };

/** Valida os campos de uma linha (na ordem de COLUNAS). Os motivos citam a coluna. */
export function validarLinha(campos: readonly string[]): ResultadoLinha {
  if (campos.length !== COLUNAS.length) {
    return {
      ok: false,
      motivos: [`número de colunas: esperado ${COLUNAS.length}, veio ${campos.length}`],
    };
  }
  const bruto = Object.fromEntries(COLUNAS.map((coluna, i) => [coluna, campos[i] ?? '']));
  const r = linhaSchema.safeParse(bruto);
  if (r.success) return { ok: true, registro: r.data };
  return {
    ok: false,
    motivos: r.error.issues.map((p) => `${String(p.path[0] ?? '?')}: ${p.message}`),
  };
}

/** O cabeçalho precisa ser exatamente COLUNAS; qualquer mudança é falha do arquivo inteiro. */
export function conferirCabecalho(campos: readonly string[]): string | null {
  const iguais =
    campos.length === COLUNAS.length && COLUNAS.every((c, i) => campos[i]?.trim() === c);
  return iguais ? null : `cabeçalho inesperado: "${campos.join(';')}"`;
}
