/**
 * Fixtures de teste. Todos os nomes são fictícios: nada aqui é informação
 * farmacológica real.
 */
export type Livre = Record<string, unknown>;

const fonte = {
  nome: 'Fonte fictícia',
  referencia: 'https://exemplo.invalid/teste',
  consultadoEm: '2026-11-11',
};
const revisao = { revisadoPor: 'Revisora de Teste', revisadoEm: '2026-11-11' };

export function parMedicamento(n: number, sobre: Livre = {}): Livre {
  return {
    id: `par-${n}`,
    tipo: 'medicamento-medicamento',
    a: { tipo: 'principio_ativo', nome: `Substância Teste ${n}A` },
    b: { tipo: 'principio_ativo', nome: `Substância Teste ${n}B` },
    esperado: { ocorrencia: true, gravidade: 'moderada' },
    fonte,
    revisao,
    ...sobre,
  };
}

export function parSemInteracao(n: number, sobre: Livre = {}): Livre {
  return parMedicamento(n, {
    tipo: 'sem-interacao',
    esperado: { ocorrencia: false },
    ...sobre,
  });
}

export function parAlimento(n: number, sobre: Livre = {}): Livre {
  return parMedicamento(n, {
    tipo: 'medicamento-alimento',
    b: { tipo: 'alimento', nome: `Alimento Teste ${n}` },
    ...sobre,
  });
}

export function parDoenca(n: number, sobre: Livre = {}): Livre {
  return parMedicamento(n, {
    tipo: 'medicamento-doenca',
    b: { tipo: 'doenca', nome: `Doença Teste ${n}` },
    ...sobre,
  });
}

export function arquivo(pares: Livre[]): Livre {
  return { versao: 1, pares };
}

/** 30 pares revisados, com cobertura de sem-interação, alimento e doença. */
export function conjuntoEstritoValido(): Livre[] {
  const pares: Livre[] = [];
  for (let n = 1; n <= 27; n++) pares.push(parMedicamento(n));
  pares.push(parSemInteracao(28), parAlimento(29), parDoenca(30));
  return pares;
}
