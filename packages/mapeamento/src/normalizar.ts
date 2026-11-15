/** Sem acento, minúsculas, espaços colapsados. É a chave de comparação de nomes em todo o P7. */
export const semAcento = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '');

export const chaveDe = (s: string): string =>
  semAcento(s).toLowerCase().replace(/\s+/g, ' ').trim();
