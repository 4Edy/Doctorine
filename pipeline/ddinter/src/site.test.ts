import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executar } from './cli.js';
import { ErroArquivo } from './processar.js';
import {
  importarSite,
  processarSite,
  COLUNAS_SITE,
  TIPOS_SITE,
  tipoDoArquivoSite,
} from './site.js';
import { serializarSite } from './saida-site.js';

/** Linhas reais das exportações do site de 2026-11-12 (DDInter 2.0, CC BY-NC-SA 4.0), encurtadas. */
const SEV = (n: string, linhas: string[]): string =>
  [
    'id,level,interaction,absorption,antagonistic_effect,distribution,excretion,metabolism,others,synergistic_effect,severity_filter',
    ...linhas,
  ].join('\r\n') + '\r\n';
const BASE: Record<string, string> = {
  severity_1: SEV('1', [
    '9,3,Coadministration of sacubitril-valsartan with an ACE inhibitor may increase the risk of angioedema.,0,0,0,0,0,0,1,1',
    '10,3,"Severe adverse effects, including fatalities, have been reported.",0,0,0,0,0,1,1,1',
  ]),
  severity_2: SEV('2', [
    '1,2,Coadministration of efavirenz with other agents known to induce hepatotoxicity may potentiate the risk of liver injury.,0,0,0,0,0,0,1,2',
    '3,2,The mechanism of this interaction has not been clearly established.,0,0,0,0,0,1,0,2',
  ]),
  severity_3: SEV('3', [
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
const conjunto = (alterar: Record<string, string> = {}) =>
  TIPOS_SITE.map((tipo) => ({
    tipo,
    bytes: Buffer.from('﻿' + (alterar[tipo] ?? (BASE[tipo] as string)), 'utf8'),
  }));
const rodar = (alterar: Record<string, string> = {}) =>
  processarSite({ arquivos: conjunto(alterar), baixadoEm: '2026-11-12' });

describe('processarSite: caminho feliz', () => {
  const r = rodar();

  it('lê o BOM, o CRLF e as aspas, e fecha a conta por arquivo', () => {
    expect(r.rejeicoes).toEqual([]);
    for (const a of r.relatorio.arquivos) expect(a.linhasLidas).toBe(a.registros + a.rejeitadas);
    expect(r.textos).toHaveLength(5);
    expect(r.textos.find((t) => t.id === 10)?.texto).toBe(
      'Severe adverse effects, including fatalities, have been reported.',
    );
  });

  it('converte o código do site no nível original e lê os mecanismos', () => {
    expect(r.textos.map((t) => [t.id, t.nivel])).toEqual([
      [1, 'Moderate'],
      [3, 'Moderate'],
      [7, 'Minor'],
      [9, 'Major'],
      [10, 'Major'],
    ]);
    expect(r.textos.find((t) => t.id === 10)?.mecanismos).toEqual(['Others', 'Synergy']);
    expect(r.relatorio.textosInteracao).toMatchObject({
      comMaisDeUmMecanismo: 1,
      idMinimo: 1,
      idMaximo: 10,
      idsAusentes: 5,
    });
  });

  it('chama a coluna `magnesium` de mecanismo e guarda o manejo do alimento', () => {
    expect(r.alimentos[0]).toMatchObject({
      idFarmaco: 'DDInter278',
      alimento: 'spinach',
      mecanismo: 'Absorption',
      manejo: 'Separate doses.',
    });
  });

  it('não perde registro por espaço sobrando: remove e avisa', () => {
    expect(r.alimentos.find((a) => a.id === 788)?.interacao).toBe(
      'Alcohol may potentiate CNS depression.',
    );
    expect(r.avisos.filter((a) => a.tipo === 'espaco-removido')).toHaveLength(1);
  });

  it('mantém dois registros do mesmo medicamento e alimento, e sinaliza níveis diferentes', () => {
    expect(r.relatorio.alimentos).toMatchObject({
      total: 3,
      chavesRepetidas: 1,
      chavesComNiveisDiferentes: 1,
    });
    expect(r.relatorio.doencas).toMatchObject({ total: 3, chavesRepetidas: 1, linhasExtras: 1 });
  });

  it('deixa referência vazia como nula e sinaliza "?" nas referências sem alterar', () => {
    expect(r.doencas.find((d) => d.id === 107)?.referencias).toBeNull();
    expect(r.relatorio.suspeitaPerdaDeCaractere).toEqual({ 'drug_food.references': 1 });
    expect(r.alimentos[0]?.referencias).toContain('Espa?ola');
  });

  it('põe proveniência em todo registro', () => {
    for (const x of [...r.textos, ...r.alimentos, ...r.doencas, ...r.duplicidade]) {
      expect(x.proveniencia).toMatchObject({
        fonte: 'ddinter-site-exportacoes',
        versao: r.relatorio.fonte.versao,
        data: '2026-11-12',
      });
    }
  });

  it('é idempotente e não depende da ordem dos arquivos', () => {
    const invertido = processarSite({
      arquivos: [...conjunto()].reverse(),
      baixadoEm: '2026-11-12',
    });
    expect(serializarSite(invertido)).toEqual(serializarSite(rodar()));
  });
});

describe('processarSite: defeitos', () => {
  it('rejeita nível que não combina com o arquivo, id repetido e flag inválida', () => {
    const r = rodar({
      severity_1: SEV('1', [
        '9,3,Texto A.,0,0,0,0,0,0,1,1',
        '11,2,Texto B.,0,0,0,0,0,0,1,1',
        '9,3,Texto C.,0,0,0,0,0,0,1,1',
        '12,3,Texto D.,0,0,0,0,0,0,2,1',
      ]),
    });
    expect(r.rejeicoes.map((x) => [x.linha, x.categoria])).toEqual([
      [3, 'esquema'],
      [4, 'id-repetido'],
      [5, 'esquema'],
    ]);
    expect(r.rejeicoes[0]?.motivos[0]).toContain('não combinam');
  });

  it('mantém texto vazio como nulo e avisa; avisa quando não há mecanismo', () => {
    const r = rodar({ severity_2: SEV('2', ['5,2,,0,0,0,0,0,0,0,2']) });
    expect(r.textos.find((t) => t.id === 5)).toMatchObject({ texto: null, mecanismos: [] });
    expect(r.relatorio.avisos.porTipo).toMatchObject({ 'texto-vazio': 1, 'sem-mecanismo': 1 });
  });

  it('rejeita identificador de medicamento fora do formato e colunas a menos', () => {
    const r = rodar({
      drug_disease:
        [
          'id,drugName,diseaseName,internalID_a_id,level,references,text',
          '1,X,Y,ABC,3,,Texto.',
          '2,X,Y',
        ].join('\n') + '\n',
    });
    expect(r.relatorio.rejeitados.porCategoria).toEqual({ esquema: 1, colunas: 1 });
  });

  it('colapsa cópia exata na duplicidade terapêutica', () => {
    const linha = 'Sutan-dm,Mix,antihistamines,Acrivastine,DDInter23,Aviso.,Nota.';
    const r = rodar({
      therapeutic_duplication:
        [COLUNAS_SITE.therapeutic_duplication.join(','), linha, linha].join('\n') + '\n',
    });
    expect(r.relatorio.duplicidade).toMatchObject({ total: 1, exatasRepetidas: 1 });
  });

  it('lista identificador de medicamento com dois nomes', () => {
    const r = rodar({
      drug_disease:
        [
          'id,drugName,diseaseName,internalID_a_id,level,references,text',
          '1,Botulinum toxin type B,Y,DDInter226,3,,T.',
          '2,Botulinum Toxin Type B,Z,DDInter226,3,,T.',
        ].join('\n') + '\n',
    });
    expect(r.relatorio.farmacos.nomesDivergentes).toEqual([
      { id: 'DDInter226', nomes: ['Botulinum Toxin Type B', 'Botulinum toxin type B'] },
    ]);
  });

  it('recusa conjunto incompleto, cabeçalho diferente, vazio e não UTF-8', () => {
    expect(() => processarSite({ arquivos: conjunto().slice(1), baixadoEm: '2026-11-12' })).toThrow(
      /faltam \[severity_1\]/,
    );
    expect(() => rodar({ drug_food: 'a,b\n1,2\n' })).toThrow(/cabeçalho diferente/);
    expect(() => rodar({ severity_3: '' })).toThrow(ErroArquivo);
    expect(() => rodar({ severity_3: SEV('3', []) })).toThrow(/só o cabeçalho/);
    const ruim = conjunto().map((a) =>
      a.tipo === 'drug_food' ? { ...a, bytes: Buffer.from([0x44, 0xe9]) } : a,
    );
    expect(() => processarSite({ arquivos: ruim, baixadoEm: '2026-11-12' })).toThrow(/UTF-8/);
  });
});

describe('tipoDoArquivoSite', () => {
  it('reconhece o nome com ou sem prefixo', () => {
    expect(tipoDoArquivoSite('severity_1.csv')).toBe('severity_1');
    expect(tipoDoArquivoSite('3e59dc25-severity_3.csv')).toBe('severity_3');
    expect(tipoDoArquivoSite('c31bc560-therapeutic_duplication.csv')).toBe(
      'therapeutic_duplication',
    );
    expect(tipoDoArquivoSite('severity_4.csv')).toBeNull();
    expect(tipoDoArquivoSite('ddinter_downloads_code_A.csv')).toBeNull();
  });
});

describe('importarSite e CLI', () => {
  let raiz: string;
  let origem: string;
  beforeEach(() => {
    raiz = mkdtempSync(join(tmpdir(), 'doctorine-site-'));
    origem = join(raiz, 'baixados');
    mkdirSync(origem);
    for (const a of conjunto()) writeFileSync(join(origem, `abc-${a.tipo}.csv`), a.bytes);
  });
  afterEach(() => rmSync(raiz, { recursive: true, force: true }));
  const dia = () => new Date('2026-11-12T15:00:00Z');

  it('registra os 6 arquivos e não muda nada ao importar de novo', () => {
    const a = importarSite({ destino: join(raiz, 'raw'), pasta: origem, agora: dia });
    const b = importarSite({
      destino: join(raiz, 'raw'),
      pasta: origem,
      agora: () => new Date('2026-12-01T00:00:00Z'),
    });
    expect(a.novo).toBe(true);
    expect(b.novo).toBe(false);
    expect(b.manifesto.baixadoEm).toBe('2026-11-12');
    expect(readdirSync(a.diretorio)).toHaveLength(7);
  });

  it('recusa pasta sem arquivos e conjunto incompleto', () => {
    mkdirSync(join(raiz, 'vazia'));
    expect(() => importarSite({ destino: raiz, pasta: join(raiz, 'vazia') })).toThrow(
      /nenhuma exportação/,
    );
    rmSync(join(origem, 'abc-drug_food.csv'));
    expect(() => importarSite({ destino: raiz, pasta: origem })).toThrow(/faltam \[drug_food\]/);
  });

  it('"site <pasta>" importa e processa; "processar-site" repete com saída idêntica', async () => {
    const r = await executar(['site', origem], { raiz, agora: dia });
    expect(r.codigo).toBe(0);
    expect(r.linhas.join('\n')).toContain(
      '5 textos de interação, 3 alimentos, 3 doenças, 1 duplicidades',
    );
    const base = join(raiz, 'data', 'processed', 'ddinter-site');
    const dir = join(base, readdirSync(base)[0] as string);
    const ler = () =>
      Object.fromEntries(readdirSync(dir).map((n) => [n, readFileSync(join(dir, n), 'utf8')]));
    const primeira = ler();
    expect((await executar(['processar-site'], { raiz })).codigo).toBe(0);
    expect(ler()).toEqual(primeira);
    expect(Object.keys(primeira)).toContain('textos-interacao.jsonl');
  });

  it('devolve 2 para uso incorreto e 1 para checksum adulterado', async () => {
    expect((await executar(['site'], { raiz })).codigo).toBe(2);
    expect((await executar(['processar-site', 'x'], { raiz })).codigo).toBe(2);
    expect((await executar(['processar-site'], { raiz })).linhas.join('\n')).toContain(
      'importar-site',
    );
    await executar(['importar-site', origem], { raiz, agora: dia });
    const bruto = join(raiz, 'data', 'raw', 'ddinter-site');
    const dir = join(bruto, readdirSync(bruto)[0] as string);
    writeFileSync(join(dir, 'severity_2.csv'), 'id,level\n1,2\n');
    const r = await executar(['processar-site'], { raiz });
    expect(r.codigo).toBe(1);
    expect(r.linhas.join('\n')).toMatch(/Erro: .*(cabeçalho|checksum)/);
  });
});
