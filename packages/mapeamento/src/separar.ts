import { chaveDe } from './normalizar.js';

/** Tamanho em que a ANVISA corta o texto de PRINCIPIO_ATIVO (ver docs/fontes/anvisa.md). */
export const LIMITE_TRUNCAMENTO = 380;

export interface Componente {
  /** Posição no texto original (base 1). */
  ordem: number;
  /** Texto do componente como veio, sem espaços nas pontas. */
  texto: string;
  chave: string;
  /**
   * Motivos pelos quais o componente não pode ser mapeado automaticamente (só por decisão
   * humana): parece mais de um componente, traz concentração ou parênteses.
   */
  suspeitas: string[];
  /** Último componente de um texto cortado pela ANVISA: pode estar incompleto. */
  truncado: boolean;
}

const CONCENTRACAO = /\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|g|ml|ui|u\.i\.|%|meq|mmol)\b/i;

/**
 * Separa o texto de princípios ativos da ANVISA em componentes. Separadores: ponto e vírgula,
 * `+` e vírgula (menos entre dígitos, como em "1,2-propanodiol"). Não separa por " e ": isso
 * pode ser parte do nome; o componente fica com a suspeita e vai para revisão.
 */
export function separarComponentes(
  texto: string | null,
  limite: number = LIMITE_TRUNCAMENTO,
): Componente[] {
  if (texto === null || texto.trim() === '') return [];
  const partes = texto
    .split(/;|\+|,(?!\d)|(?<!\d),/)
    .map((p) => p.trim().replace(/\s+/g, ' '))
    .filter((p) => p !== '');
  const cortado = texto.length >= limite;
  return partes.map((p, i) => {
    const suspeitas: string[] = [];
    if (/\s(?:e|\/)\s/i.test(p) || p.includes('/'))
      suspeitas.push('pode ser mais de um componente');
    if (/[()[\]]/.test(p)) suspeitas.push('tem parênteses');
    if (CONCENTRACAO.test(p)) suspeitas.push('tem concentração no texto');
    return {
      ordem: i + 1,
      texto: p,
      chave: chaveDe(p),
      suspeitas,
      truncado: cortado && i === partes.length - 1,
    };
  });
}
