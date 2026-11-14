/**
 * Gravidade padronizada do Doctorine e conversão da classificação original das fontes.
 *
 * A escala de exibição tem seis níveis (ver `severity` em @doctorine/design-tokens). Cinco deles
 * podem ser **gravados** numa interação; "nenhuma ocorrência" é o resultado de uma consulta sem
 * registro, nunca um valor de linha.
 *
 * O DDInter não tem "contraindicada": esse nível só entra por uma fonte ou revisão futura, e por
 * isso nenhuma conversão abaixo o produz.
 */

/** Da mais para a menos grave. */
export const GRAVIDADES = ['contraindicada', 'grave', 'moderada', 'leve', 'indeterminada'] as const;
export type Gravidade = (typeof GRAVIDADES)[number];

/** Classificação original do DDInter, como vem nos arquivos e nas exportações do site. */
export const NIVEIS_ORIGINAIS = ['Major', 'Moderate', 'Minor', 'Unknown'] as const;
export type NivelOriginal = (typeof NIVEIS_ORIGINAIS)[number];

const DO_NIVEL: Record<NivelOriginal, Gravidade> = {
  Major: 'grave',
  Moderate: 'moderada',
  Minor: 'leve',
  Unknown: 'indeterminada',
};

/** Conversão de um nível original do DDInter. */
export const gravidadeDoNivel = (nivel: NivelOriginal): Gravidade => DO_NIVEL[nivel];

const POSICAO: Record<Gravidade, number> = Object.fromEntries(
  GRAVIDADES.map((g, i) => [g, i]),
) as Record<Gravidade, number>;

/** Compara na ordem de exibição: negativo se `a` é mais grave que `b`. */
export const compararGravidade = (a: Gravidade, b: Gravidade): number => POSICAO[a] - POSICAO[b];

/**
 * A mais grave de uma lista. Entre fontes que discordam, o app mostra o pior caso (a ausência de
 * um alerta custa mais do que um alerta a mais); a classificação original de cada fonte continua
 * gravada ao lado. "Indeterminada" só vence quando nenhuma fonte deu uma gravidade.
 */
export function gravidadeMaisGrave(gravidades: readonly [Gravidade, ...Gravidade[]]): Gravidade {
  return gravidades.reduce((pior, g) => (compararGravidade(g, pior) < 0 ? g : pior));
}

/** Gravidade resultante de uma ou mais classificações originais (por exemplo, par do site e CSV). */
export function gravidadeDosNiveis(
  niveis: readonly [NivelOriginal, ...NivelOriginal[]],
): Gravidade {
  const [primeiro, ...resto] = niveis.map(gravidadeDoNivel) as [Gravidade, ...Gravidade[]];
  return gravidadeMaisGrave([primeiro, ...resto]);
}
