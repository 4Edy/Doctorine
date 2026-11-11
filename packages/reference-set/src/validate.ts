import { arquivoSchema, TIPOS_PAR, type Par, type TipoPar } from './schema.js';

export const MINIMO_ESTRITO = 30;

export interface Problema {
  caminho: string;
  mensagem: string;
}

export interface Resumo {
  total: number;
  revisados: number;
  pendentes: number;
  porTipo: Record<TipoPar, number>;
}

export interface Resultado {
  ok: boolean;
  problemas: Problema[];
  /** null quando o arquivo nem passou no esquema. */
  resumo: Resumo | null;
}

export interface Opcoes {
  /**
   * Modo estrito = critério de conclusão da Fase 0: pelo menos 30 pares, todos
   * revisados, com cobertura de "sem interação", alimento e doença.
   */
  estrito?: boolean;
}

/** Minúsculas, sem acentos e com espaços normalizados, para comparar nomes. */
export function normalizarNome(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function chaveNomes(par: Par): string {
  return [par.a.nome, par.b.nome].map(normalizarNome).sort().join('|');
}

function caminhoDe(path: ReadonlyArray<PropertyKey>): string {
  return path.length === 0 ? '(arquivo)' : path.map(String).join('.');
}

function resumir(pares: readonly Par[]): Resumo {
  const porTipo = Object.fromEntries(TIPOS_PAR.map((tipo) => [tipo, 0])) as Record<TipoPar, number>;
  let revisados = 0;
  for (const par of pares) {
    porTipo[par.tipo] += 1;
    if (par.revisao !== null) revisados += 1;
  }
  return { total: pares.length, revisados, pendentes: pares.length - revisados, porTipo };
}

export function validar(entrada: unknown, opcoes: Opcoes = {}): Resultado {
  const lido = arquivoSchema.safeParse(entrada);
  if (!lido.success) {
    return {
      ok: false,
      resumo: null,
      problemas: lido.error.issues.map((issue) => ({
        caminho: caminhoDe(issue.path),
        mensagem: issue.message,
      })),
    };
  }

  const { pares } = lido.data;
  const problemas: Problema[] = [];

  const idsVistos = new Map<string, number>();
  const chavesVistas = new Map<string, string>();
  const semInteracao = new Map<string, string>();

  pares.forEach((par, i) => {
    const caminho = `pares.${i}`;

    const idAnterior = idsVistos.get(par.id);
    if (idAnterior !== undefined) {
      problemas.push({
        caminho: `${caminho}.id`,
        mensagem: `id "${par.id}" repetido (também em pares.${idAnterior})`,
      });
    } else {
      idsVistos.set(par.id, i);
    }

    // A com B equivale a B com A: o mesmo par não pode entrar duas vezes.
    const chave = `${par.tipo}|${chaveNomes(par)}`;
    const duplicado = chavesVistas.get(chave);
    if (duplicado !== undefined) {
      problemas.push({
        caminho,
        mensagem: `par repetido (mesmo tipo e mesmos itens, em qualquer ordem) de "${duplicado}"`,
      });
    } else {
      chavesVistas.set(chave, par.id);
    }

    if (par.tipo === 'sem-interacao') semInteracao.set(chaveNomes(par), par.id);
  });

  pares.forEach((par, i) => {
    if (par.tipo !== 'medicamento-medicamento') return;
    const contraditorio = semInteracao.get(chaveNomes(par));
    if (contraditorio !== undefined) {
      problemas.push({
        caminho: `pares.${i}`,
        mensagem: `contradiz o par "sem-interacao" "${contraditorio}" (mesmos medicamentos)`,
      });
    }
  });

  const resumo = resumir(pares);

  if (opcoes.estrito === true) {
    if (resumo.total < MINIMO_ESTRITO) {
      problemas.push({
        caminho: 'pares',
        mensagem: `o conjunto precisa de pelo menos ${MINIMO_ESTRITO} pares (tem ${resumo.total})`,
      });
    }
    pares.forEach((par, i) => {
      if (par.revisao === null) {
        problemas.push({
          caminho: `pares.${i}.revisao`,
          mensagem: `par "${par.id}" ainda não foi revisado pela farmacêutica`,
        });
      }
    });
    if (resumo.porTipo['sem-interacao'] === 0) {
      problemas.push({
        caminho: 'pares',
        mensagem: 'o conjunto precisa incluir ao menos um par sem interação conhecida',
      });
    }
    if (resumo.porTipo['medicamento-alimento'] === 0) {
      problemas.push({
        caminho: 'pares',
        mensagem: 'o conjunto precisa incluir ao menos um par com alimento',
      });
    }
    if (resumo.porTipo['medicamento-doenca'] === 0) {
      problemas.push({
        caminho: 'pares',
        mensagem: 'o conjunto precisa incluir ao menos um par com doença',
      });
    }
  }

  return { ok: problemas.length === 0, problemas, resumo };
}
