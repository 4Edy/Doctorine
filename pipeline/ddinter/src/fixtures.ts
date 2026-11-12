/**
 * Fixtures de teste: linhas reais dos arquivos `ddinter_downloads_code_*.csv` baixados em
 * 2026-11-12 (DDInter, CC BY-NC-SA 4.0; ver docs/fontes/ddinter.md). Escolhidas pelos casos que
 * exercitam: nome com vírgula entre aspas, nível Unknown, o mesmo par em dois arquivos (D e V),
 * pares nos dois sentidos e pares com ordem de identificador invertida.
 */
import { LETRAS_ESPERADAS, COLUNAS } from './schema.js';

export const CABECALHO = COLUNAS.join(',');

export const LINHAS_POR_LETRA: Record<string, readonly string[]> = {
  A: [
    'DDInter1263,Naltrexone,DDInter1,Abacavir,Moderate',
    'DDInter58,Aluminum hydroxide,DDInter582,Dolutegravir,Major',
  ],
  B: ['DDInter975,Iron,DDInter582,Dolutegravir,Major'],
  D: ['DDInter690,Ethanol,DDInter1,Abacavir,Minor'],
  H: ['DDInter513,Dexamethasone,DDInter582,Dolutegravir,Minor'],
  L: ['DDInter1,Abacavir,DDInter228,Brentuximab vedotin,Moderate'],
  P: [
    'DDInter942,"Interferon alfa-2a, Recombinant",DDInter1202,Metronidazole,Moderate',
    'DDInter458,Cyclosporine,DDInter134,Atovaquone,Unknown',
  ],
  R: ['DDInter1019,Lamivudine,DDInter1123,Mannitol,Moderate'],
  // o mesmo par de D (Ethanol + Abacavir), com os lados trocados, como acontece nos arquivos reais
  V: [
    'DDInter1,Abacavir,DDInter690,Ethanol,Minor',
    'DDInter1,Abacavir,DDInter424,Cobicistat,Moderate',
  ],
};

export function csv(linhas: readonly string[], eol = '\r\n'): string {
  return [CABECALHO, ...linhas].join(eol) + eol;
}

/** Os 8 arquivos como bytes UTF-8, com fim de linha CRLF como no site. */
export function conjuntoAmostra(
  alterar: Record<string, readonly string[]> = {},
): Array<{ letra: string; bytes: Uint8Array }> {
  return LETRAS_ESPERADAS.map((letra) => ({
    letra,
    bytes: Buffer.from(csv(alterar[letra] ?? LINHAS_POR_LETRA[letra] ?? []), 'utf8'),
  }));
}
