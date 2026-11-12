import { describe, expect, it } from 'vitest';
import { conjuntoAmostra, csv, LINHAS_POR_LETRA } from './fixtures.js';
import { ErroArquivo, processar, versaoDoConjunto } from './processar.js';
import { serializar } from './saida.js';

const rodar = (
  alterar: Record<string, readonly string[]> = {},
  arquivos = conjuntoAmostra(alterar),
) => processar({ arquivos, baixadoEm: '2026-11-12', origem: 'manual' });

describe('processar: caminho feliz', () => {
  const r = rodar();

  it('fecha a conta: linhas = distintas + repetidas + rejeitadas', () => {
    const { relatorio: rel } = r;
    expect(rel.linhasLidas).toBe(11);
    expect(rel.interacoesDistintas).toBe(10);
    expect(rel.repetidas).toEqual({ total: 1, mesmoArquivo: 0, outroArquivo: 1 });
    expect(rel.rejeitados.total).toBe(0);
    expect(rel.linhasLidas).toBe(
      rel.interacoesDistintas + rel.repetidas.total + rel.rejeitados.total,
    );
  });

  it('trata o par sem direção: o mesmo par nos dois sentidos conta uma vez, com as duas origens', () => {
    const par = r.interacoes.find((i) => i.idA === 'DDInter1' && i.idB === 'DDInter690');
    expect(par).toMatchObject({
      nomeA: 'Abacavir',
      nomeB: 'Ethanol',
      nivel: 'Minor',
      conflito: null,
    });
    expect(par?.proveniencia.origens).toEqual([
      { arquivo: 'ddinter_downloads_code_D.csv', linha: 2 },
      { arquivo: 'ddinter_downloads_code_V.csv', linha: 2 },
    ]);
    expect(r.relatorio.paresPorNumeroDeArquivos).toEqual({ '1': 9, '2': 1 });
  });

  it('põe o menor identificador primeiro e ordena a saída', () => {
    for (const i of r.interacoes) {
      expect(Number(i.idA.slice(7))).toBeLessThan(Number(i.idB.slice(7)));
    }
    const chaves = r.interacoes.map((i) => [Number(i.idA.slice(7)), Number(i.idB.slice(7))]);
    expect(chaves).toEqual(
      [...chaves].sort(
        (a, b) => (a[0] as number) - (b[0] as number) || (a[1] as number) - (b[1] as number),
      ),
    );
  });

  it('guarda nome com vírgula e nível Unknown como vieram', () => {
    expect(r.farmacos.find((f) => f.id === 'DDInter942')?.nome).toBe(
      'Interferon alfa-2a, Recombinant',
    );
    expect(r.interacoes.find((i) => i.idA === 'DDInter134')?.nivel).toBe('Unknown');
    expect(r.relatorio.niveis).toEqual({ Major: 2, Moderate: 5, Minor: 2, Unknown: 1 });
  });

  it('põe proveniência em todo registro', () => {
    for (const i of r.interacoes) {
      expect(i.proveniencia).toMatchObject({
        fonte: 'ddinter-downloads',
        versao: r.relatorio.fonte.versao,
        data: '2026-11-12',
      });
      expect(i.proveniencia.origens.length).toBeGreaterThan(0);
    }
  });

  it('conta interações por medicamento e as letras em que ele aparece', () => {
    expect(r.farmacos.find((f) => f.id === 'DDInter1')).toMatchObject({
      nome: 'Abacavir',
      interacoes: 4,
      arquivos: ['A', 'D', 'L', 'V'],
    });
  });

  it('é idempotente: duas execuções geram saídas idênticas byte a byte', () => {
    expect(serializar(rodar())).toEqual(serializar(rodar()));
  });

  it('não depende da ordem em que os arquivos chegam', () => {
    const invertido = [...conjuntoAmostra()].reverse();
    expect(serializar(rodar({}, invertido))).toEqual(serializar(r));
  });
});

describe('processar: defeitos nos dados', () => {
  it('rejeita com motivo, sem corrigir em silêncio', () => {
    const r = rodar({
      B: [
        ...(LINHAS_POR_LETRA['B'] as string[]),
        'DDInter1,Abacavir,DDInter2,Abatacept,Severe',
        'DDInter1,Abacavir,DDInter2',
        'DDInter5,Z,DDInter5,Z,Minor',
        'DDInter3,"Aberto,DDInter4,X,Minor',
      ],
    });
    expect(r.relatorio.rejeitados.total).toBe(4);
    expect(r.relatorio.rejeitados.porCategoria).toEqual({
      'csv-malformado': 1,
      colunas: 1,
      esquema: 2,
    });
    expect(r.relatorio.rejeitados.porColuna).toEqual({ Level: 1, DDInterID_B: 1 });
    expect(r.rejeicoes.map((x) => [x.arquivo, x.linha])).toEqual([
      ['ddinter_downloads_code_B.csv', 3],
      ['ddinter_downloads_code_B.csv', 4],
      ['ddinter_downloads_code_B.csv', 5],
      ['ddinter_downloads_code_B.csv', 6],
    ]);
    expect(r.rejeicoes[0]?.bruto).toEqual([
      'DDInter1',
      'Abacavir',
      'DDInter2',
      'Abatacept',
      'Severe',
    ]);
    const rel = r.relatorio;
    expect(rel.linhasLidas).toBe(
      rel.interacoesDistintas + rel.repetidas.total + rel.rejeitados.total,
    );
  });

  it('linha repetida no mesmo arquivo conta como repetida, não como erro', () => {
    const r = rodar({
      B: [
        'DDInter975,Iron,DDInter582,Dolutegravir,Major',
        'DDInter975,Iron,DDInter582,Dolutegravir,Major',
      ],
    });
    expect(r.relatorio.repetidas).toEqual({ total: 2, mesmoArquivo: 1, outroArquivo: 1 });
    expect(r.relatorio.rejeitados.total).toBe(0);
  });

  it('par com níveis diferentes em arquivos diferentes: mantém o mais grave e avisa', () => {
    const r = rodar({ V: ['DDInter1,Abacavir,DDInter690,Ethanol,Major'] });
    const par = r.interacoes.find((i) => i.idA === 'DDInter1' && i.idB === 'DDInter690');
    expect(par?.nivel).toBe('Major');
    expect(par?.conflito).toEqual(['Major', 'Minor']);
    expect(r.relatorio.avisos.porTipo).toEqual({ 'nivel-conflitante': 1 });
    expect(r.avisos[0]?.detalhe).toContain('mantido o mais grave, Major');
  });

  it('Unknown nunca vence um nível definido', () => {
    const r = rodar({ V: ['DDInter1,Abacavir,DDInter690,Ethanol,Unknown'] });
    const par = r.interacoes.find((i) => i.idA === 'DDInter1' && i.idB === 'DDInter690');
    expect(par?.nivel).toBe('Minor');
    expect(par?.conflito).toEqual(['Minor', 'Unknown']);
  });

  it('medicamento com dois nomes para o mesmo identificador: avisa e mantém o primeiro', () => {
    const r = rodar({ V: ['DDInter1,Abacavir sulfate,DDInter424,Cobicistat,Moderate'] });
    expect(r.farmacos.find((f) => f.id === 'DDInter1')?.nome).toBe('Abacavir');
    expect(r.relatorio.avisos.porTipo['nome-divergente']).toBe(1);
  });

  it('sinaliza nomes com "?" ou fora de ASCII, sem alterar', () => {
    const r = rodar({ V: ['DDInter900,Café?,DDInter424,Cobicistat,Moderate'] });
    expect(r.relatorio.farmacos.suspeitaPerdaDeCaractere).toEqual({
      registros: 1,
      exemplos: ['Café?'],
    });
  });

  it('aceita arquivo com BOM e LF', () => {
    const base = conjuntoAmostra();
    const [primeiro, ...resto] = base;
    const comBom = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(csv(LINHAS_POR_LETRA['A'] ?? [], '\n')),
    ]);
    const r = rodar({}, [{ letra: 'A', bytes: comBom }, ...resto]);
    expect(primeiro?.letra).toBe('A');
    expect(r.relatorio.rejeitados.total).toBe(0);
  });
});

describe('processar: erros do conjunto inteiro', () => {
  it('recusa conjunto com arquivo faltando, sobrando ou repetido', () => {
    const [, ...semA] = conjuntoAmostra();
    expect(() => rodar({}, semA)).toThrow(/faltam \[A\]/);
    expect(() =>
      rodar({}, [...conjuntoAmostra(), { letra: 'N', bytes: Buffer.from(csv([])) }]),
    ).toThrow(/inesperados \[N\]/);
    expect(() => rodar({}, [...conjuntoAmostra(), ...conjuntoAmostra().slice(0, 1)])).toThrow(
      /repetidos \[A\]/,
    );
  });

  it('recusa cabeçalho diferente, arquivo vazio, só cabeçalho e não UTF-8', () => {
    const base = conjuntoAmostra().slice(1);
    const com = (bytes: Uint8Array) => [{ letra: 'A', bytes }, ...base];
    expect(() => rodar({}, com(Buffer.from('a,b,c\n1,2,3\n')))).toThrow(ErroArquivo);
    expect(() => rodar({}, com(Buffer.from('')))).toThrow(/vazio/);
    expect(() => rodar({}, com(Buffer.from(csv([]))))).toThrow(/só o cabeçalho/);
    expect(() => rodar({}, com(Buffer.from([0x44, 0xe9, 0x0a])))).toThrow(/UTF-8/);
  });
});

describe('versaoDoConjunto', () => {
  it('muda quando um arquivo muda e não depende da ordem', () => {
    const a = [
      { letra: 'A', sha256: '1' },
      { letra: 'B', sha256: '2' },
    ];
    expect(versaoDoConjunto(a)).toEqual(versaoDoConjunto([...a].reverse()));
    expect(versaoDoConjunto(a).versao).not.toBe(
      versaoDoConjunto([
        { letra: 'A', sha256: '1' },
        { letra: 'B', sha256: '3' },
      ]).versao,
    );
  });
});
