/**
 * Entradas de teste da carga. ANVISA, CSVs e site passam pelos pipelines de verdade (assim o teste
 * quebra se o formato que eles escrevem mudar); pares e manejo usam os tipos exportados pelo
 * pipeline do DDInter (o typecheck acusa se o formato mudar). Linhas reais das fontes, encurtadas.
 */
import * as anvisa from '@doctorine/pipeline-anvisa';
import * as ddinter from '@doctorine/pipeline-ddinter';
import type {
  AlternativasRegistro,
  FarmacoSite,
  ParSite,
  TextoManejo,
} from '@doctorine/pipeline-ddinter';

export type { AlternativasRegistro, FarmacoSite, ParSite, TextoManejo };

export const jsonl = (itens: readonly unknown[]): string => ddinter.jsonl(itens);

export const processarAnvisa = anvisa.processar;
export const serializarAnvisa = anvisa.serializar;
export const processarCsvs = ddinter.processar;
export const serializarCsvs = ddinter.serializar;
export const processarSite = ddinter.processarSite;
export const serializarSite = ddinter.serializarSite;

/** Cópia do CSV da ANVISA em Windows-1252, como o arquivo real. */
export const emLatin1 = (texto: string): Uint8Array => Buffer.from(texto, 'latin1');

export const csvAmostra = (): string =>
  [
    anvisa.COLUNAS.join(';'),
    // o mesmo número de registro com situação e princípio ativo diferentes (acontece no arquivo real)
    '"MEDICAMENTO";"TORVILIP";"19/12/2016";"Similar";126750245;"122026";"25351546591201501";"ANTILIPEMICOS";"72593791000111 - NOVA QUIMICA FARMACÊUTICA S/A";"Inativo";"atorvastatina cálcica"',
    '"MEDICAMENTO";"TORVILIP";"19/12/2016";"Similar";126750245;"122026";"25351546591201501";"ANTILIPEMICOS";"72593791000111 - NOVA QUIMICA FARMACÊUTICA S/A";"Ativo";"atorvastatina cálcica, ezetimiba"',
    '"MEDICAMENTO";"TRESIBA";"17/02/2014";"Biológico";117660029;"022029";"25351136532201241";"ANTIDIABETICOS";"82277955000155 - NOVO NORDISK FARMACÊUTICA DO BRASIL LTDA";"Ativo";"insulina degludeca"',
    '"MEDICAMENTO";"VASELINA LIQUIDA PHYTOLAB";"04/11/2008";"BAIXO RISCO";;;;;"02817180000124 - PHYTOLAB INDUSTRIA FARMACEUTICA LTDA - EPP";"Inativo";',
    '"MEDICAMENTO";"ÁGUA PARA INJEÇÃO";"26/05/2008";"Específico";151670031;"052028";"25351129487200818";"DILUENTES E VEICULOS DE MEDICAMENTOS";"04301884000175 - AUROBINDO PHARMA INDÚSTRIA FARMACÊUTICA LIMITADA";"Inativo";"água para injetáveis"',
    '"MEDICAMENTO";"TINTURA IODO 5% VANSIL";"23/03/2016";"BAIXO RISCO";;"032021";;;"39032974000192 - VIC PHARMA INDUSTRIA E COMERCIO LTDA";"Ativo";',
  ].join('\n') + '\n';

const CSVS: Record<string, string[]> = {
  A: ['DDInter690,Ethanol,DDInter1,Abacavir,Minor'],
  // o pipeline exige pelo menos uma linha em cada um dos 8 arquivos
  B: ['DDInter975,Iron,DDInter582,Dolutegravir,Major'],
  D: ['DDInter58,Aluminum hydroxide,DDInter582,Dolutegravir,Major'],
  H: ['DDInter1237,Moexipril,DDInter1630,Sacubitril,Minor'],
  L: ['DDInter1,Abacavir,DDInter228,Brentuximab vedotin,Moderate'],
  P: ['DDInter458,Cyclosporine,DDInter134,Atovaquone,Unknown'],
  R: ['DDInter1019,Lamivudine,DDInter1123,Mannitol,Moderate'],
  V: ['DDInter1,Abacavir,DDInter424,Cobicistat,Moderate'],
};
const csvs = (linhasA?: string[]): Array<{ letra: string; bytes: Uint8Array }> =>
  ddinter.LETRAS_ESPERADAS.map((letra) => ({
    letra,
    bytes: Buffer.from(
      [
        ddinter.COLUNAS.join(','),
        ...((letra === 'A' ? linhasA : undefined) ?? CSVS[letra] ?? []),
      ].join('\r\n') + '\r\n',
      'utf8',
    ),
  }));

const SEV = (linhas: string[]): string =>
  [
    'id,level,interaction,absorption,antagonistic_effect,distribution,excretion,metabolism,others,synergistic_effect,severity_filter',
    ...linhas,
  ].join('\r\n') + '\r\n';
const SITE: Record<string, string> = {
  severity_1: SEV([
    '9,3,Coadministration of sacubitril-valsartan with an ACE inhibitor may increase the risk of angioedema.,0,0,0,0,0,0,1,1',
    '10,3,"Severe adverse effects, including fatalities, have been reported.",0,0,0,0,0,1,1,1',
  ]),
  severity_2: SEV([
    '1,2,Coadministration of efavirenz with other agents known to induce hepatotoxicity may potentiate the risk of liver injury.,0,0,0,0,0,0,1,2',
    '3,2,The mechanism of this interaction has not been clearly established.,0,0,0,0,0,1,0,2',
  ]),
  severity_3: SEV([
    '7,1,Consumption of ethanol during treatment with abacavir results in a decrease in elimination of abacavir.,0,0,0,0,1,0,0,3',
  ]),
  drug_food:
    [
      'id,drugName,foodName,internalID_a_id,level,references,newInteraction,newManagement,magnesium',
      '1,Calcium lactate,spinach,DDInter278,2,"Mangels AR ""Bone nutrients for vegetarians."" Am J Clin Nutr 100 (2014):  epub|Agencia Espa?ola de Medicamentos",Spinach may reduce absorption.,Separate doses.,Absorption',
      '121,Hydrocodone,alcohol,DDInter1244,2,Ref A,Ethanol may potentiate CNS depression.,Avoid alcohol.,Synergy',
      '788,Hydrocodone,alcohol,DDInter1244,3,Ref B,Alcohol may potentiate CNS depression. ,Avoid alcohol.,Synergy',
    ].join('\n') + '\n',
  drug_disease:
    [
      'id,drugName,diseaseName,internalID_a_id,level,references,text',
      '1,Abacavir,Liver Diseases,DDInter1,3,Yarchoan R et al.,Abacavir should be used with caution.',
      '107,Phenytoin,Depressive Disorder,DDInter411,2,,Antiepileptic drugs have been associated with suicidal thoughts.',
      '108,Phenytoin,Depressive Disorder,DDInter411,2,Ref,Benzodiazepines depress the central nervous system.',
    ].join('\r\n') + '\r\n',
  therapeutic_duplication:
    [
      'drugmulti_trade,drugmulti,drugtype,drugb,internalID_b_id,warning,note',
      'Sutan-dm,Dexchlorpheniramine/dextromethorphan/pseudoephedrine,antihistamines,Acrivastine,DDInter23,Maximum is one.,Note: benefits may outweigh risks.',
    ].join('\r\n') + '\r\n',
};
const site = (): Array<{ tipo: (typeof ddinter.TIPOS_SITE)[number]; bytes: Uint8Array }> =>
  ddinter.TIPOS_SITE.map((tipo) => ({
    tipo,
    bytes: Buffer.from('﻿' + (SITE[tipo] as string), 'utf8'),
  }));

const lado = (id: number, nome: string, drugbank: string | null) => ({
  id: `DDInter${id}`,
  drugbank,
  nome,
});
const prov = (idTexto: number, posicao: number) => ({
  fonte: 'ddinter-site-lista-de-pares',
  versao: 'teste',
  data: '2026-11-13',
  idTexto,
  posicao,
});
const par = (
  idPar: number,
  idTexto: number,
  nivel: ParSite['nivel'],
  mecanismos: string[],
  a: ParSite['a'],
  b: ParSite['b'],
): ParSite => ({ idPar, idTexto, nivel, mecanismos, a, b, proveniencia: prov(idTexto, 1) });

const pares: ParSite[] = [
  par(
    1,
    7,
    'Minor',
    ['Metabolism'],
    lado(1, 'Abacavir', 'DB01048'),
    lado(690, 'Ethanol', 'DB00898'),
  ),
  par(
    2,
    1,
    'Moderate',
    ['Others'],
    lado(1, 'Abacavir', 'DB01048'),
    lado(228, 'Brentuximab vedotin', 'DB08873'),
  ),
  par(
    3,
    9,
    'Major',
    ['Synergy'],
    lado(1237, 'Moexipril', 'DB00691'),
    lado(1630, 'Sacubitril', 'DB09292'),
  ),
  par(4, 3, 'Moderate', ['Others'], lado(1, 'Abacavir', 'DB01048'), lado(2, 'Acarbose', 'DB00284')),
  par(5, 3, 'Moderate', ['Others'], lado(1, 'Abacavir', 'DB01048'), lado(2, 'Acarbose', 'DB00284')),
  // aponta para um texto que não existe nas exportações: a carga descarta com motivo
  par(99, 99999, 'Moderate', [], lado(3, 'Terceiro', null), lado(4, 'Quarto', null)),
];
const farmacosPares: FarmacoSite[] = [
  { id: 'DDInter1', drugbank: 'DB01048', nome: 'Abacavir', pares: 4 },
  { id: 'DDInter2', drugbank: 'DB00284', nome: 'Acarbose', pares: 2 },
  { id: 'DDInter3', drugbank: null, nome: 'Terceiro', pares: 1 },
  { id: 'DDInter4', drugbank: null, nome: 'Quarto', pares: 1 },
  { id: 'DDInter228', drugbank: 'DB08873', nome: 'Brentuximab vedotin', pares: 1 },
  { id: 'DDInter690', drugbank: 'DB00898', nome: 'Ethanol', pares: 1 },
  { id: 'DDInter1237', drugbank: 'DB00691', nome: 'Moexipril', pares: 1 },
  { id: 'DDInter1630', drugbank: 'DB09292', nome: 'Sacubitril', pares: 1 },
];

const provManejo = (idPar: number) => ({
  fonte: 'ddinter-site-pagina-do-par' as const,
  url: `https://site.invalid/server/interact/${idPar}/`,
  versao: 'teste',
  data: '2026-11-14',
});
const textosManejo: TextoManejo[] = [
  {
    idTexto: 9,
    idParLido: 3,
    interacao:
      'Coadministration of sacubitril-valsartan with an ACE inhibitor may increase the risk of angioedema.',
    manejo: 'Evitar o uso conjunto.',
    referencias: ['Ref A', 'Ref B'],
    proveniencia: provManejo(3),
  },
  {
    idTexto: 10,
    idParLido: 6,
    interacao: null,
    manejo: 'Monitorar.',
    referencias: [],
    proveniencia: provManejo(6),
  },
  {
    idTexto: 1,
    idParLido: 2,
    interacao: null,
    manejo: 'Monitorar a função hepática.',
    referencias: ['Ref C'],
    proveniencia: provManejo(2),
  },
  {
    idTexto: 3,
    idParLido: 4,
    interacao: null,
    manejo: null,
    referencias: [],
    proveniencia: provManejo(4),
  },
];
const alt = (id: number): { id: string; nome: string } => ({
  id: `DDInter${id}`,
  nome: `Nome${id}`,
});
const alternativas: AlternativasRegistro[] = [
  {
    idPar: 3,
    idTexto: 9,
    idFarmaco: 'DDInter1237',
    nome: 'Moexipril',
    idParceiro: 'DDInter1630',
    grupos: [{ atc: 'C09A', farmacos: [alt(10), alt(11)] }],
    completo: [alt(10), alt(11), alt(12)],
  },
  {
    idPar: 3,
    idTexto: 9,
    idFarmaco: 'DDInter1630',
    nome: 'Sacubitril',
    idParceiro: 'DDInter1237',
    grupos: [],
    completo: [],
  },
];

export const conjuntoParaTeste = {
  csvs,
  site,
  pares,
  farmacosPares,
  textosManejo,
  alternativas,
};
