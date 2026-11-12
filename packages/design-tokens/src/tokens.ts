/**
 * Doctorine — tokens da identidade "Botanical Clinical".
 *
 * Fonte única de cores, tipografia, espaçamento, raios, sombras e gravidade.
 * Extraídos do protótipo do Lovable (src/design-system/tokens.ts) e ajustados na revisão do P3
 * (ver docs/design/identidade-visual.md). Só valores simples, sem dependência de web ou React
 * Native, para o app em Expo (P13) consumir direto.
 */

export const colors = {
  ivory: '#FFFBF8', // fundo principal
  warmWhite: '#FFFEFC', // superfícies e cartões
  blush: '#F8E9ED', // destaques
  lavender: '#E9D9EF', // elementos secundários
  sage: '#B8CDBD', // decoração de saúde (nunca texto, nunca borda de controle)
  medicinal: '#78998A', // verde decorativo da marca (ícones grandes, linhas); 3,0:1 sobre ivory
  medicinalStrong: '#4F7565', // ações; texto branco 5,2:1; texto sobre ivory 5,0:1
  plum: '#59465B', // títulos e ênfase
  mist: '#F3EFF0', // fundo de seções
  roseGray: '#D8CED3', // divisores e bordas DECORATIVAS (1,5:1; não usar em controles)
  borderStrong: '#8C8190', // borda de campos e controles interativos (≥3:1, WCAG 1.4.11)
  charcoal: '#302A33', // texto
  textMuted: '#675B6A', // texto secundário (AA sobre ivory, blush, lavender e mist)
  onAction: '#FFFFFF',
} as const;

/** Gravidade clínica: independente da paleta da marca. Nunca rosa nem verde. */
export const severity = {
  grave: { fg: '#9F1D20', bg: '#FDECEC', border: '#E8B4B4', label: 'Grave ou contraindicada' },
  moderada: { fg: '#8A4B00', bg: '#FFF1DC', border: '#EFC98F', label: 'Moderada' },
  leve: { fg: '#1E4F8F', bg: '#E8F0FB', border: '#AFC6E9', label: 'Leve' },
  indeterminada: { fg: '#4A4F57', bg: '#EEF0F2', border: '#C5CAD1', label: 'Não determinada' },
  nenhuma: {
    fg: '#3D3A40',
    bg: '#FFFFFF',
    border: '#9C949F',
    label: 'Nenhuma ocorrência encontrada',
  },
} as const;

export type SeverityLevel = keyof typeof severity;

/** Ordem obrigatória de exibição, da mais para a menos grave. */
export const severityOrder: readonly SeverityLevel[] = [
  'grave',
  'moderada',
  'leve',
  'indeterminada',
  'nenhuma',
];

/** Estados de proveniência do dado. */
export const dataState = {
  demo: { fg: '#59465B', bg: '#E9D9EF', label: 'Exemplo ilustrativo' },
  integrada: { fg: '#2F5546', bg: '#E3EDE6', label: 'Fonte integrada' },
  naoVerificado: { fg: '#7A4A00', bg: '#FCEFD6', label: 'Não verificado' },
  semInfo: { fg: '#4A4F57', bg: '#EEF0F2', label: 'Sem informação disponível' },
} as const;

export type DataStateKind = keyof typeof dataState;

export const typography = {
  /** Pilha para web e protótipo. */
  fontSans: "'Manrope', system-ui, sans-serif",
  fontSerif: "'Cormorant Garamond', Georgia, serif",
  /**
   * React Native não aceita pilha nem peso numérico com fonte customizada: cada peso é uma
   * família carregada por @expo-google-fonts (Manrope_400Regular etc.).
   */
  fontFamilyNative: {
    regular: 'Manrope_400Regular',
    medium: 'Manrope_500Medium',
    semibold: 'Manrope_600SemiBold',
    bold: 'Manrope_700Bold',
    brand: 'CormorantGaramond_600SemiBold',
  },
  /** Mínimo de 14: o protótipo usava 12 e 13 em alguns rótulos, corrigido no app. */
  size: { caption: 14, body: 16, bodyLg: 18, title: 22, display: 30, brand: 36 },
  weight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
  lineHeight: { body: 1.5, title: 1.25 },
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radii = { sm: 10, md: 16, lg: 20, pill: 999 } as const;
/** Alvo de toque mínimo em dp. */
export const touch = { min: 48 } as const;

/** Sombras em CSS (web) e em props do React Native (Android usa elevation). */
export const shadows = {
  soft: {
    css: '0 1px 2px rgba(48,42,51,0.04), 0 4px 14px rgba(89,70,91,0.06)',
    native: {
      shadowColor: '#59465B',
      shadowOpacity: 0.08,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    },
  },
  raised: {
    css: '0 6px 24px rgba(89,70,91,0.12)',
    native: {
      shadowColor: '#59465B',
      shadowOpacity: 0.14,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 6,
    },
  },
} as const;

export const motion = { fast: 150, base: 220 } as const;
