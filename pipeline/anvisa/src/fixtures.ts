/**
 * Fixtures de teste: linhas reais da amostra de DADOS_ABERTOS_MEDICAMENTOS.csv (2026-11-11).
 * São dados abertos da ANVISA. Escolhidas pelos casos que exercitam: acentos, campos vazios,
 * vários princípios ativos e registros sem número.
 */
import { COLUNAS } from './schema.js';

export const CABECALHO = COLUNAS.join(';');

export const LINHAS_AMOSTRA: readonly string[] = [
  '"MEDICAMENTO";"TORVILIP";"19/12/2016";"Similar";126750245;"122026";"25351546591201501";"ANTILIPEMICOS";"72593791000111 - NOVA QUIMICA FARMACÊUTICA S/A";"Inativo";"atorvastatina cálcica"',
  '"MEDICAMENTO";"TRESIBA";"17/02/2014";"Biológico";117660029;"022029";"25351136532201241";"ANTIDIABETICOS";"82277955000155 - NOVO NORDISK FARMACÊUTICA DO BRASIL LTDA";"Ativo";"insulina degludeca"',
  '"MEDICAMENTO";"VASELINA LIQUIDA PHYTOLAB";"04/11/2008";"BAIXO RISCO";;;;;"02817180000124 - PHYTOLAB INDUSTRIA FARMACEUTICA LTDA - EPP";"Inativo";',
  '"MEDICAMENTO";"ÁGUA PARA INJEÇÃO";"26/05/2008";"Específico";151670031;"052028";"25351129487200818";"DILUENTES E VEICULOS DE MEDICAMENTOS";"04301884000175 - AUROBINDO PHARMA INDÚSTRIA FARMACÊUTICA LIMITADA";"Inativo";"água para injetáveis"',
  '"MEDICAMENTO";"CANDICORT";"06/05/1980";"Similar";105730066;"052035";"2599100369880";"GLICOCORTICOIDES TOPICOS - ASSOCIACAO MEDICAMENTOSA";"60659463002992 - ACHÉ LABORATÓRIOS FARMACÊUTICOS S.A";"Inativo";"cetoconazol, dipropionato de betametasona"',
  '"MEDICAMENTO";"NEO MISTATIN";"21/03/2011";;172870375;"032012";"25351269914201021";;"02932074000191 - HYPERA S.A.";"Inativo";"nistatina"',
  '"MEDICAMENTO";"TINTURA IODO 5% VANSIL";"23/03/2016";"BAIXO RISCO";;"032021";;;"39032974000192 - VIC PHARMA INDUSTRIA E COMERCIO LTDA";"Ativo";',
  '"MEDICAMENTO";"CODEÍNA + GUAICOLATO DE GLICERINA + FENILTOLOXAMINA";"01/03/1996";"Similar";113000226;"062006";"2599101535466";"ANTITUSSIGENOS-ASSOCIACOES MEDICAMENTOSAS";"02685377000157 - SANOFI-AVENTIS FARMACÊUTICA LTDA";"Inativo";',
];

/** Monta o texto de um arquivo (cabeçalho + linhas, LF, com quebra final). */
export function csvAmostra(linhas: readonly string[] = LINHAS_AMOSTRA): string {
  return [CABECALHO, ...linhas].join('\n') + '\n';
}

/** O arquivo real é Windows-1252; os testes geram os bytes do mesmo jeito. */
export function emLatin1(texto: string): Uint8Array {
  return Buffer.from(texto, 'latin1');
}
