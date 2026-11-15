import { describe, expect, it } from 'vitest';
import {
  IndiceDeNomes,
  chaveDe,
  mapear,
  removerSal,
  removerSalComoSugestao,
  separarComponentes,
  validarDecisoes,
  variantesEmIngles,
  nomeSemSal,
  ErroMapeamento,
  type Decisao,
  type EntradaMapeamento,
} from './index.js';

describe('separar componentes', () => {
  it('separa por vírgula, ponto e vírgula e +, guardando a ordem', () => {
    const c = separarComponentes(
      'atorvastatina cálcica, ezetimiba; losartana potássica + hidroclorotiazida',
    );
    expect(c.map((x) => x.chave)).toEqual([
      'atorvastatina calcica',
      'ezetimiba',
      'losartana potassica',
      'hidroclorotiazida',
    ]);
    expect(c.map((x) => x.ordem)).toEqual([1, 2, 3, 4]);
  });
  it('não separa vírgula entre dígitos', () => {
    expect(separarComponentes('1,2-propanodiol').map((x) => x.chave)).toEqual(['1,2-propanodiol']);
  });
  it('texto vazio ou nulo não tem componentes', () => {
    expect(separarComponentes(null)).toEqual([]);
    expect(separarComponentes('   ')).toEqual([]);
  });
  it('marca suspeitas: " e ", barra, parênteses e concentração', () => {
    const [a, b, c, d] = separarComponentes('x e y, a/b, z (anidro), w 500 mg');
    expect(a?.suspeitas).toContain('pode ser mais de um componente');
    expect(b?.suspeitas).toContain('pode ser mais de um componente');
    expect(c?.suspeitas).toContain('tem parênteses');
    expect(d?.suspeitas).toContain('tem concentração no texto');
  });
  it('só o último componente de um texto cortado fica marcado', () => {
    const c = separarComponentes('aaaa, bbbb, cccc', 16);
    expect(c.map((x) => x.truncado)).toEqual([false, false, true]);
    expect(separarComponentes('aaaa, bbbb', 380).some((x) => x.truncado)).toBe(false);
  });
});

describe('sais', () => {
  it('tira cloridrato e adjetivos de sal, e diz o que tirou', () => {
    expect(removerSal('cloridrato de metformina')).toMatchObject({
      chave: 'metformina',
      regras: ['prefixo "cloridrato de"'],
    });
    expect(removerSal('atorvastatina calcica triidratada')).toMatchObject({
      chave: 'atorvastatina',
    });
  });
  it('não tira o que é o próprio medicamento', () => {
    for (const k of [
      'sulfato de magnesio',
      'cloreto de sodio',
      'acetato de calcio',
      'hidroxido de aluminio',
    ]) {
      expect(removerSal(k).chave).toBe(k);
    }
  });
  it('sulfato só é tirado como sugestão', () => {
    expect(removerSalComoSugestao('sulfato de salbutamol').chave).toBe('salbutamol');
  });
  it('mantém o acento do texto original ao aplicar o corte', () => {
    const s = removerSal('cloridrato de bupropiona');
    expect(nomeSemSal('Cloridrato de Bupropiona', s)).toBe('bupropiona');
    const s2 = removerSal('atorvastatina calcica');
    expect(nomeSemSal('atorvastatina cálcica', s2)).toBe('atorvastatina');
  });
});

describe('grafias em inglês', () => {
  const pares: Array<[string, string]> = [
    ['atorvastatina', 'atorvastatin'],
    ['metformina', 'metformin'],
    ['dexametasona', 'dexamethasone'],
    ['omeprazol', 'omeprazole'],
    ['furosemida', 'furosemide'],
    ['losartana', 'losartan'],
    ['ibuprofeno', 'ibuprofen'],
    ['diclofenaco', 'diclofenac'],
    ['amoxicilina', 'amoxicillin'],
    ['sinvastatina', 'simvastatin'],
    ['hidroclorotiazida', 'hydrochlorothiazide'],
    ['espironolactona', 'spironolactone'],
    ['carbamazepina', 'carbamazepine'],
    ['ciprofloxacino', 'ciprofloxacin'],
    ['cetoconazol', 'ketoconazole'],
    ['insulina', 'insulin'],
    ['acido acetilsalicilico', 'acetylsalicylic acid'],
  ];
  it.each(pares)('%s → %s', (pt, en) => {
    expect(variantesEmIngles(pt)).toContain(en);
  });
  it('é determinístico e limitado', () => {
    expect(variantesEmIngles('hidroclorotiazida')).toEqual(variantesEmIngles('hidroclorotiazida'));
    expect(variantesEmIngles('hidroclorotiazida').length).toBeLessThan(300);
  });
  it('o índice acha o igual e sugere o parecido, nunca o distante', () => {
    const ix = new IndiceDeNomes([
      { id: 1, nome: 'Atorvastatin' },
      { id: 2, nome: 'Phenytoin' },
      { id: 3, nome: 'Warfarin' },
    ]);
    expect(ix.exatos(['atorvastatin'])).toEqual([1]);
    const c = ix.parecidos(variantesEmIngles('fenitoina'));
    expect(c[0]?.id).toBe(2);
    expect(c.map((x) => x.id)).not.toContain(3);
  });
});

const dec = (d: Partial<Decisao> & Pick<Decisao, 'chave' | 'acao'>): Decisao =>
  ({ revisadoPor: 'Farmacêutica', revisadoEm: '2026-11-20', ...d }) as Decisao;

const FARMACOS = [
  { id: 1, nomeEn: 'Atorvastatin' },
  { id: 2, nomeEn: 'Ezetimibe' },
  { id: 3, nomeEn: 'Metformin' },
  { id: 4, nomeEn: 'Acetaminophen' },
  { id: 5, nomeEn: 'Phenytoin' },
  { id: 6, nomeEn: 'Aspirin' },
  { id: 7, nomeEn: 'Lisinopril' },
  { id: 8, nomeEn: 'Zinc' },
  { id: 9, nomeEn: 'Zinc' },
];
const MEDS = [
  { id: 1, nome: 'TORVA', ativo: true, principioAtivoOriginal: 'atorvastatina cálcica' },
  {
    id: 2,
    nome: 'TORVA PLUS',
    ativo: true,
    principioAtivoOriginal: 'atorvastatina cálcica, ezetimiba',
  },
  { id: 3, nome: 'GLIFAGE', ativo: true, principioAtivoOriginal: 'cloridrato de metformina' },
  { id: 4, nome: 'TYLENOL', ativo: true, principioAtivoOriginal: 'paracetamol' },
  { id: 5, nome: 'HIDANTAL', ativo: true, principioAtivoOriginal: 'fenitoína' },
  { id: 6, nome: 'ANTIGO', ativo: false, principioAtivoOriginal: 'paracetamol' },
  { id: 7, nome: 'VASELINA', ativo: true, principioAtivoOriginal: null },
  {
    id: 8,
    nome: 'COMBO',
    ativo: true,
    principioAtivoOriginal: 'metformina, paracetamol, lisinopril',
  },
  { id: 9, nome: 'ZINCO', ativo: true, principioAtivoOriginal: 'zinco' },
];
const entrada = (extra: Partial<EntradaMapeamento> = {}): EntradaMapeamento => ({
  medicamentos: MEDS,
  farmacos: FARMACOS,
  decisoes: [],
  ...extra,
});
const chaveDoMap = (s: ReturnType<typeof mapear>, chave: string) =>
  s.mapeamentos.find((m) => m.origem === 'anvisa-componente' && m.chaveOrigem === chave);

describe('mapear', () => {
  const s = mapear(entrada());

  it('casa por grafia exata e tira o sal seguro', () => {
    expect(chaveDoMap(s, 'atorvastatina calcica')).toMatchObject({ status: 'automatico' });
    expect(chaveDoMap(s, 'cloridrato de metformina')).toMatchObject({ status: 'automatico' });
    expect(chaveDoMap(s, 'metformina')?.slug).toBe(chaveDoMap(s, 'cloridrato de metformina')?.slug);
    expect(s.regrasDeSalUsadas['prefixo "cloridrato de"']).toBe(1);
  });

  it('o que não casa fica pendente, sem princípio ativo, e entra na fila com candidatos', () => {
    expect(chaveDoMap(s, 'paracetamol')).toMatchObject({ status: 'pendente', slug: null });
    expect(chaveDoMap(s, 'fenitoina')).toMatchObject({ status: 'pendente', slug: null });
    const item = s.fila.find((f) => f.chave === 'fenitoina');
    expect(item?.candidatos[0]).toMatchObject({ id: 5, nome: 'Phenytoin' });
    expect(item?.exemplos).toEqual(['HIDANTAL']);
  });

  it('nome em inglês repetido no DDInter é ambíguo, não automático', () => {
    expect(chaveDoMap(s, 'zinco')?.status).toBe('pendente'); // "zinco" não é grafia de "zinc"
    const s2 = mapear(
      entrada({
        medicamentos: [{ id: 1, nome: 'Z', ativo: true, principioAtivoOriginal: 'zinc' }],
      }),
    );
    expect(chaveDoMap(s2, 'zinc')).toMatchObject({ status: 'pendente' });
    expect(chaveDoMap(s2, 'zinc')?.motivo).toMatch(/ambíguo/);
  });

  it('a fila vem ordenada pelo número de medicamentos ativos', () => {
    const ativos = s.fila.map((f) => f.medicamentosAtivos);
    expect([...ativos].sort((a, b) => b - a)).toEqual(ativos);
    // paracetamol: 2 ativos (4 e 8); o medicamento 6 é inativo
    expect(s.fila[0]).toMatchObject({
      chave: 'paracetamol',
      medicamentosAtivos: 2,
      medicamentosTotal: 3,
    });
  });

  it('medicamento com componente pendente nunca recebe o ligado como se estivesse completo', () => {
    const m8 = s.medicamentos.find((m) => m.medicamentoId === 8);
    expect(m8).toMatchObject({ componentes: 3, pendentes: 1 });
    expect(s.ligacoes.filter((l) => l.medicamentoId === 8)).toHaveLength(2);
    const m4 = s.medicamentos.find((m) => m.medicamentoId === 4);
    expect(m4).toMatchObject({ componentes: 1, pendentes: 1 });
    expect(s.ligacoes.some((l) => l.medicamentoId === 4)).toBe(false);
  });

  it('medicamento com vários princípios gera todas as ligações, na ordem do texto', () => {
    const l = s.ligacoes.filter((x) => x.medicamentoId === 2);
    expect(l.map((x) => x.ordem)).toEqual([1, 2]);
    expect(new Set(l.map((x) => x.slug)).size).toBe(2);
  });

  it('um mesmo medicamento do DDInter dá um único princípio ativo, mesmo com sal e sem sal', () => {
    const slugs = s.principios.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const met = s.principios.filter((p) => p.ddinterIds.includes(3));
    expect(met).toHaveLength(1);
    expect(met[0]).toMatchObject({ nomePt: 'metformina', nomeEn: 'Metformin' });
  });

  it('sem texto de princípio ativo não há componentes nem ligações', () => {
    expect(s.medicamentos.find((m) => m.medicamentoId === 7)).toMatchObject({
      componentes: 0,
      pendentes: 0,
    });
  });

  it('cobertura conta só os ativos e diz quanto a fila resolve', () => {
    const c = s.cobertura;
    expect(c.medicamentos).toMatchObject({
      total: 9,
      ativos: 8,
      ativosSemPrincipio: 1,
      ativosComTexto: 7,
    });
    expect(c.ativos.completos).toBe(3); // 1, 2, 3
    expect(c.percentualCompletos).toBeCloseTo((3 / 7) * 100, 0);
    const ultimo = c.seResolvidos.at(-1);
    expect(ultimo?.percentual).toBe(100);
  });

  it('a mesma entrada dá a mesma saída, e a ordem de entrada não importa', () => {
    const a = JSON.stringify(mapear(entrada()));
    const b = JSON.stringify(
      mapear(entrada({ medicamentos: [...MEDS].reverse(), farmacos: [...FARMACOS].reverse() })),
    );
    expect(b).toBe(a);
  });
});

describe('mapear com decisões', () => {
  it('equivale: confirma e vence o automático e o pendente', () => {
    const s = mapear(
      entrada({
        decisoes: [
          dec({ chave: 'paracetamol', acao: 'equivale', ddinterIds: [4], nomePt: 'paracetamol' }),
        ],
      }),
    );
    expect(chaveDoMap(s, 'paracetamol')).toMatchObject({ status: 'confirmado' });
    expect(
      s.mapeamentos.find((m) => m.origem === 'ddinter-farmaco' && m.chaveOrigem === '4'),
    ).toMatchObject({
      status: 'confirmado',
    });
    expect(s.medicamentos.find((m) => m.medicamentoId === 4)?.pendentes).toBe(0);
    expect(s.fila.some((f) => f.chave === 'paracetamol')).toBe(false);
    expect(s.principios.find((p) => p.ddinterIds.includes(4))).toMatchObject({
      nomePt: 'paracetamol',
      nomeEn: 'Acetaminophen',
    });
  });

  it('sem-equivalente cria o princípio só em português, sem ligar ao DDInter', () => {
    const s = mapear(
      entrada({ decisoes: [dec({ chave: 'paracetamol', acao: 'sem-equivalente' })] }),
    );
    expect(chaveDoMap(s, 'paracetamol')).toMatchObject({ status: 'confirmado' });
    const p = s.principios.find((x) => x.nomePt === 'paracetamol');
    expect(p).toMatchObject({ nomeEn: null, ddinterIds: [] });
    expect(s.cobertura.farmacosLigados).toBeLessThan(5);
  });

  it('mesmo-que herda o princípio do alvo; alvo pendente não vale', () => {
    const meds = [
      ...MEDS,
      { id: 10, nome: 'OUTRO', ativo: true, principioAtivoOriginal: 'acetaminofeno' },
    ];
    const ok = mapear(
      entrada({
        medicamentos: meds,
        decisoes: [
          dec({ chave: 'paracetamol', acao: 'equivale', ddinterIds: [4] }),
          dec({ chave: 'acetaminofeno', acao: 'mesmo-que', comoChave: 'paracetamol' }),
        ],
      }),
    );
    expect(chaveDoMap(ok, 'acetaminofeno')?.slug).toBe(chaveDoMap(ok, 'paracetamol')?.slug);
    const ruim = mapear(
      entrada({
        medicamentos: meds,
        decisoes: [dec({ chave: 'acetaminofeno', acao: 'mesmo-que', comoChave: 'paracetamol' })],
      }),
    );
    expect(chaveDoMap(ruim, 'acetaminofeno')).toMatchObject({ status: 'pendente', slug: null });
    expect(ruim.avisos.join('\n')).toMatch(/está pendente/);
  });

  it('ciclo de mesmo-que não trava nem mapeia', () => {
    const s = mapear(
      entrada({
        decisoes: [
          dec({ chave: 'paracetamol', acao: 'mesmo-que', comoChave: 'fenitoina' }),
          dec({ chave: 'fenitoina', acao: 'mesmo-que', comoChave: 'paracetamol' }),
        ],
      }),
    );
    expect(chaveDoMap(s, 'paracetamol')?.status).toBe('pendente');
  });

  it('id do DDInter que não existe derruba a execução', () => {
    expect(() =>
      mapear(
        entrada({ decisoes: [dec({ chave: 'paracetamol', acao: 'equivale', ddinterIds: [999] })] }),
      ),
    ).toThrow(ErroMapeamento);
  });

  it('decisão para componente que não existe nos dados só avisa', () => {
    const s = mapear(
      entrada({ decisoes: [dec({ chave: 'inexistente', acao: 'sem-equivalente' })] }),
    );
    expect(s.avisos.join('\n')).toMatch(/sem componente correspondente/);
  });

  it('duas decisões que ligam ao mesmo medicamento do DDInter viram um princípio só', () => {
    const meds = [
      { id: 1, nome: 'A', ativo: true, principioAtivoOriginal: 'paracetamol' },
      { id: 2, nome: 'B', ativo: true, principioAtivoOriginal: 'acetaminofeno' },
    ];
    const s = mapear(
      entrada({
        medicamentos: meds,
        decisoes: [
          dec({ chave: 'paracetamol', acao: 'equivale', ddinterIds: [4] }),
          dec({ chave: 'acetaminofeno', acao: 'equivale', ddinterIds: [4] }),
        ],
      }),
    );
    expect(s.principios).toHaveLength(1);
    expect(
      s.nomes
        .filter((n) => n.idioma === 'pt')
        .map((n) => n.nome)
        .sort(),
    ).toEqual(['acetaminofeno', 'paracetamol']);
  });
});

describe('mapear: casos que exigem revisão humana', () => {
  const um = (texto: string): ReturnType<typeof mapear> =>
    mapear(
      entrada({ medicamentos: [{ id: 1, nome: 'X', ativo: true, principioAtivoOriginal: texto }] }),
    );

  it('texto cortado pela ANVISA: o último componente nunca é ligado', () => {
    const s = mapear(
      entrada({
        limiteTruncamento: 'atorvastatina calcica, metformina'.length,
        medicamentos: [
          {
            id: 1,
            nome: 'X',
            ativo: true,
            principioAtivoOriginal: 'atorvastatina calcica, metformina',
          },
        ],
      }),
    );
    expect(s.medicamentos[0]).toMatchObject({ componentes: 2, pendentes: 1, truncado: true });
    expect(s.ligacoes).toHaveLength(1);
    expect(s.cobertura.ativos.completos).toBe(0);
    expect(s.cobertura.ativos.comTextoCortado).toBe(1);
  });

  it.each([
    ['metformina e atorvastatina', /mais de um componente/],
    ['metformina (anidra)', /parênteses/],
    ['metformina 500 mg', /concentração/],
  ])('"%s" vai para a fila mesmo parecendo casar', (texto, motivo) => {
    const s = um(texto);
    expect(s.mapeamentos[0]?.status).toBe('pendente');
    expect(s.fila[0]?.motivo).toMatch(motivo);
  });

  it('sulfato de magnésio não vira o princípio "magnésio" por engano', () => {
    const s = mapear(
      entrada({
        farmacos: [...FARMACOS, { id: 20, nomeEn: 'Magnesium' }],
        medicamentos: [
          { id: 1, nome: 'X', ativo: true, principioAtivoOriginal: 'sulfato de magnésio' },
        ],
      }),
    );
    expect(s.mapeamentos[0]).toMatchObject({ status: 'pendente', slug: null });
  });
});

describe('conjunto de referência', () => {
  it('diz quais nomes estão confirmados, só automáticos, pendentes ou não encontrados', () => {
    const s = mapear(
      entrada({
        decisoes: [dec({ chave: 'paracetamol', acao: 'equivale', ddinterIds: [4] })],
        referencia: [
          { id: 'r1', nome: 'Paracetamol' },
          { id: 'r2', nome: 'Metformina' },
          { id: 'r3', nome: 'Fenitoína' },
          { id: 'r4', nome: 'Varfarina' },
          { id: 'r5', nome: 'Atorvastatina' },
        ],
      }),
    );
    expect(Object.fromEntries(s.referencia.map((r) => [r.id, r.situacao]))).toEqual({
      r1: 'confirmado',
      r2: 'automatico',
      r3: 'pendente',
      r4: 'nao-encontrado',
      r5: 'automatico',
    });
  });
});

describe('arquivo de decisões', () => {
  const ok = {
    versao: 1,
    atualizadoEm: '2026-11-20',
    decisoes: [dec({ chave: 'a', acao: 'sem-equivalente' })],
  };
  it('aceita um arquivo válido', () => {
    expect(validarDecisoes(ok).ok).toBe(true);
  });
  it.each([
    [
      'chave não normalizada',
      { ...ok, decisoes: [dec({ chave: 'Atorvastatina', acao: 'sem-equivalente' })] },
    ],
    ['chave repetida', { ...ok, decisoes: [ok.decisoes[0], ok.decisoes[0]] }],
    [
      'equivale sem ids',
      { ...ok, decisoes: [{ ...dec({ chave: 'a', acao: 'equivale' }), ddinterIds: [] }] },
    ],
    ['sem revisor', { ...ok, decisoes: [{ ...ok.decisoes[0], revisadoPor: '' }] }],
    ['data inexistente', { ...ok, atualizadoEm: '2026-02-31' }],
    ['campo desconhecido', { ...ok, decisoes: [{ ...ok.decisoes[0], extra: 1 }] }],
    [
      'mesmo-que para si mesmo',
      { ...ok, decisoes: [dec({ chave: 'a', acao: 'mesmo-que', comoChave: 'a' })] },
    ],
  ])('recusa: %s', (_nome, bruto) => {
    expect(validarDecisoes(bruto).ok).toBe(false);
  });
});

describe('normalização', () => {
  it('tira acento, caixa e espaços repetidos', () => {
    expect(chaveDe('  Atorvastatina   CÁLCICA ')).toBe('atorvastatina calcica');
  });
});
