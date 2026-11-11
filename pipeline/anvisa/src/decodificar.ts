export type Codificacao = 'utf-8' | 'windows-1252';

/**
 * Os dados abertos da ANVISA saem em Windows-1252 (confirmado na amostra de 2026-11-11). Se um dia
 * passarem a sair em UTF-8, o arquivo é reconhecido sozinho: texto Latin-1 com acentos quase nunca
 * é UTF-8 válido, então tentar UTF-8 estrito primeiro não gera falso positivo.
 * Texto só ASCII é idêntico nas duas codificações e é rotulado como "utf-8".
 */
export function decodificar(bytes: Uint8Array): { texto: string; codificacao: Codificacao } {
  try {
    const texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { texto, codificacao: 'utf-8' };
  } catch {
    return { texto: new TextDecoder('windows-1252').decode(bytes), codificacao: 'windows-1252' };
  }
}
