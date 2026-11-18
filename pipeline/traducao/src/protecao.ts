/**
 * Proteção dos nomes de fármacos. A tradução nunca mexe em nome de fármaco: cada nome conhecido do
 * texto em inglês vira um marcador `[[F1]]`, `[[F2]]`... antes de ir para a tradução, e o marcador
 * volta a ser nome depois. O nome em português vem do mapeamento (P7), nunca da tradução; sem
 * mapeamento, volta o nome como estava no texto (inglês), e o app mostra isso como "nome não
 * verificado".
 */
export interface NomeFarmaco {
  id: string;
  nome: string;
}
export interface Marca {
  n: number;
  idFarmaco: string;
  /** Como o nome aparecia no texto original. */
  superficie: string;
}
export interface Protegido {
  texto: string;
  marcas: Marca[];
}

const MARCADOR = /\[\[F(\d+)\]\]/g;
const escapar = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LETRA_OU_NUMERO = '\\p{L}\\p{N}';

export interface Protetor {
  proteger(texto: string): Protegido;
  /** Troca os marcadores por nomes. `nomesPt` mapeia id DDInter → nome em português. */
  restaurar(
    traduzido: string,
    marcas: readonly Marca[],
    nomesPt?: ReadonlyMap<string, string>,
  ): string;
}

export function criarProtetor(nomes: readonly NomeFarmaco[]): Protetor {
  // nome (minúsculo) → id; nome repetido com ids diferentes: fica o menor id, de forma estável
  const porNome = new Map<string, string>();
  for (const { id, nome } of [...nomes].sort((a, b) =>
    a.id.localeCompare(b.id, 'en', { numeric: true }),
  )) {
    const chave = nome.trim().toLowerCase();
    if (chave.length >= 3 && !porNome.has(chave)) porNome.set(chave, id);
  }
  const ordenados = [...porNome.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b));
  const regex =
    ordenados.length === 0
      ? null
      : new RegExp(
          `(?<![${LETRA_OU_NUMERO}])(?:${ordenados.map(escapar).join('|')})(?![${LETRA_OU_NUMERO}])`,
          'giu',
        );
  return {
    proteger(texto) {
      const marcas: Marca[] = [];
      if (regex === null) return { texto, marcas };
      const saida = texto.replace(regex, (achado) => {
        const n = marcas.length + 1;
        marcas.push({
          n,
          idFarmaco: porNome.get(achado.toLowerCase()) as string,
          superficie: achado,
        });
        return `[[F${n}]]`;
      });
      return { texto: saida, marcas };
    },
    restaurar(traduzido, marcas, nomesPt) {
      return traduzido.replace(MARCADOR, (m, n: string, pos: number, todo: string) => {
        const marca = marcas.find((x) => x.n === Number(n));
        if (marca === undefined) return m;
        const nome = nomesPt?.get(marca.idFarmaco) ?? marca.superficie;
        const inicioDeFrase = pos === 0 || /(?:^|[.!?:;]\s+|\n\s*)$/.test(todo.slice(0, pos));
        return ajustarCaixa(nome, inicioDeFrase);
      });
    },
  };
}

/**
 * Caixa do nome conforme a posição na frase em português (não a do inglês): maiúscula no início
 * da frase; minúscula no meio, a não ser que o nome tenha outra maiúscula (siglas, "St. John's wort").
 */
export function ajustarCaixa(nome: string, inicioDeFrase: boolean): string {
  if (nome === '') return nome;
  const primeira = nome.charAt(0);
  if (inicioDeFrase) return primeira.toUpperCase() + nome.slice(1);
  const resto = nome.slice(1);
  if (primeira !== primeira.toLowerCase() && resto === resto.toLowerCase()) {
    return primeira.toLowerCase() + resto;
  }
  return nome;
}

/** Marcadores presentes em um texto, ordenados (com repetição). */
export function marcadoresDe(texto: string): number[] {
  return [...texto.matchAll(MARCADOR)].map((m) => Number(m[1])).sort((a, b) => a - b);
}
