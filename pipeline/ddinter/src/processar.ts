import { createHash } from 'node:crypto';
import { lerCsv } from './csv.js';
import {
  COLUNAS,
  LETRAS_ESPERADAS,
  NIVEIS,
  ORDEM_GRAVIDADE,
  conferirCabecalho,
  nomeArquivo,
  validarLinha,
  type Nivel,
} from './schema.js';

export const FONTE_ID = 'ddinter-downloads';
const MAX_AMOSTRA = 10;

/** Falha do conjunto inteiro (arquivo faltando, cabeçalho diferente, checksum que não bate). */
export class ErroArquivo extends Error {
  override name = 'ErroArquivo';
}

export interface ArquivoEntrada {
  letra: string;
  bytes: Uint8Array;
}

export interface EntradaConjunto {
  arquivos: readonly ArquivoEntrada[];
  /** AAAA-MM-DD, vem do manifesto (nunca do relógio, para o resultado ser repetível). */
  baixadoEm: string;
  origem?: 'download' | 'manual';
}

export interface Origem {
  /** Nome canônico do arquivo (`ddinter_downloads_code_X.csv`). */
  arquivo: string;
  /** Linha do arquivo (base 1, o cabeçalho é a linha 1). */
  linha: number;
}

export interface Proveniencia {
  fonte: string;
  /** Primeiros 12 caracteres do SHA-256 do conjunto de arquivos. */
  versao: string;
  /** AAAA-MM-DD do download. */
  data: string;
  /** Onde o par aparece. Mais de uma origem = o mesmo par está em mais de um arquivo. */
  origens: Origem[];
}

export interface Interacao {
  /** Menor identificador numérico primeiro: o par não tem direção. */
  idA: string;
  nomeA: string;
  idB: string;
  nomeB: string;
  /** Classificação original do DDInter. Em conflito entre arquivos, a mais grave. */
  nivel: Nivel;
  /** Níveis diferentes vistos para o mesmo par; null quando não há conflito. */
  conflito: Nivel[] | null;
  proveniencia: Proveniencia;
}

export interface Farmaco {
  id: string;
  nome: string;
  /** Letras dos arquivos em que o medicamento aparece. */
  arquivos: string[];
  /** Pares distintos em que o medicamento aparece. */
  interacoes: number;
}

export type CategoriaRejeicao = 'csv-malformado' | 'colunas' | 'esquema';
const CATEGORIAS: readonly CategoriaRejeicao[] = ['csv-malformado', 'colunas', 'esquema'];

export interface Rejeicao {
  arquivo: string;
  linha: number;
  categoria: CategoriaRejeicao;
  motivos: string[];
  /** Campos como vieram no arquivo, para conferir à mão. */
  bruto: string[];
}

export type TipoAviso = 'nivel-conflitante' | 'nome-divergente';

/** O registro foi mantido; o aviso diz o que foi decidido e com base em quê. */
export interface Aviso {
  arquivo: string;
  linha: number;
  tipo: TipoAviso;
  detalhe: string;
}

export interface RelatorioQualidade {
  fonte: {
    id: string;
    origem: 'download' | 'manual' | null;
    sha256: string;
    versao: string;
    baixadoEm: string;
  };
  arquivos: Array<{
    letra: string;
    arquivo: string;
    sha256: string;
    bytes: number;
    linhasLidas: number;
    rejeitadas: number;
    /** Pares distintos que aparecem no arquivo. */
    pares: number;
    /** Pares que só aparecem neste arquivo. */
    exclusivos: number;
  }>;
  linhasLidas: number;
  interacoesDistintas: number;
  /** Linhas cujo par já tinha sido lido antes (no mesmo arquivo ou em outro). Não é erro. */
  repetidas: { total: number; mesmoArquivo: number; outroArquivo: number };
  rejeitados: {
    total: number;
    porCategoria: Record<string, number>;
    porColuna: Record<string, number>;
    amostra: Array<Pick<Rejeicao, 'arquivo' | 'linha' | 'categoria' | 'motivos'>>;
  };
  avisos: { total: number; porTipo: Record<string, number>; amostra: Aviso[] };
  niveis: Record<string, number>;
  paresPorNumeroDeArquivos: Record<string, number>;
  farmacos: {
    total: number;
    /** Nomes com "?" ou caractere fora de ASCII: a origem pode ter perdido acento. */
    suspeitaPerdaDeCaractere: { registros: number; exemplos: string[] };
    /** Quantidade de medicamentos por faixa de pares. */
    porNumeroDeInteracoes: Record<string, number>;
  };
}

export interface ResultadoProcessamento {
  interacoes: Interacao[];
  farmacos: Farmaco[];
  rejeicoes: Rejeicao[];
  avisos: Aviso[];
  relatorio: RelatorioQualidade;
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Identidade do conjunto: depende só do conteúdo dos 8 arquivos, na ordem das letras. */
export function versaoDoConjunto(arquivos: ReadonlyArray<{ letra: string; sha256: string }>): {
  sha256: string;
  versao: string;
} {
  const texto = [...arquivos]
    .sort((a, b) => (a.letra < b.letra ? -1 : a.letra > b.letra ? 1 : 0))
    .map((a) => `${a.letra}:${a.sha256}\n`)
    .join('');
  const hash = createHash('sha256').update(texto).digest('hex');
  return { sha256: hash, versao: hash.slice(0, 12) };
}

const numero = (id: string): number => Number(id.slice('DDInter'.length));

function decodificar(bytes: Uint8Array, arquivo: string): string {
  let texto: string;
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ErroArquivo(`${arquivo} não é UTF-8 válido; não vou adivinhar a codificação`);
  }
  return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
}

const contar = (d: Record<string, number>, chave: string): void => {
  d[chave] = (d[chave] ?? 0) + 1;
};

interface ParEmAndamento {
  idA: string;
  idB: string;
  nivel: Nivel;
  niveis: Set<Nivel>;
  origens: Origem[];
}

export function processar(entrada: EntradaConjunto): ResultadoProcessamento {
  const letras = entrada.arquivos.map((a) => a.letra).sort();
  const faltam = LETRAS_ESPERADAS.filter((l) => !letras.includes(l));
  const sobram = letras.filter((l) => !(LETRAS_ESPERADAS as readonly string[]).includes(l));
  const repetidas = letras.filter((l, i) => letras.indexOf(l) !== i);
  if (faltam.length > 0 || sobram.length > 0 || repetidas.length > 0) {
    throw new ErroArquivo(
      `conjunto de arquivos incompleto ou com excesso: ` +
        `faltam [${faltam.join(', ')}], inesperados [${sobram.join(', ')}], repetidos [${repetidas.join(', ')}]`,
    );
  }

  const ordenados = [...entrada.arquivos].sort((a, b) => (a.letra < b.letra ? -1 : 1));
  const hashes = ordenados.map((a) => ({
    letra: a.letra,
    sha256: sha256(a.bytes),
    bytes: a.bytes,
  }));
  const conjunto = versaoDoConjunto(hashes);

  const pares = new Map<string, ParEmAndamento>();
  const nomes = new Map<string, { nome: string; arquivos: Set<string> }>();
  const rejeicoes: Rejeicao[] = [];
  const avisos: Aviso[] = [];
  const porArquivo = new Map<string, { linhas: number; rejeitadas: number }>();
  const rep = { total: 0, mesmoArquivo: 0, outroArquivo: 0 };

  for (const { letra, bytes } of ordenados) {
    const arquivo = nomeArquivo(letra);
    const registros = lerCsv(decodificar(bytes, arquivo), ',');
    const [cabecalho, ...dados] = registros;
    if (cabecalho === undefined) throw new ErroArquivo(`${arquivo} está vazio`);
    const motivo = conferirCabecalho(cabecalho.campos);
    if (motivo !== null) throw new ErroArquivo(`${arquivo}: ${motivo}`);
    if (dados.length === 0)
      throw new ErroArquivo(`${arquivo} tem só o cabeçalho, sem linhas de dados`);

    const estat = { linhas: dados.length, rejeitadas: 0 };
    porArquivo.set(letra, estat);
    const rejeitar = (
      linha: number,
      categoria: CategoriaRejeicao,
      motivos: string[],
      bruto: string[],
    ): void => {
      estat.rejeitadas++;
      rejeicoes.push({ arquivo, linha, categoria, motivos, bruto });
    };

    for (const reg of dados) {
      if (reg.erro !== undefined) {
        rejeitar(reg.linha, 'csv-malformado', [reg.erro], reg.campos);
        continue;
      }
      if (reg.campos.length !== COLUNAS.length) {
        rejeitar(
          reg.linha,
          'colunas',
          [`${reg.campos.length} colunas, esperadas ${COLUNAS.length}`],
          reg.campos,
        );
        continue;
      }
      const v = validarLinha(reg.campos);
      if (!v.ok) {
        rejeitar(reg.linha, 'esquema', v.motivos, reg.campos);
        continue;
      }
      const { idA, nomeA, idB, nomeB, nivel } = v.valor;

      for (const [idx, nomeLido] of [
        [idA, nomeA],
        [idB, nomeB],
      ] as const) {
        const conhecido = nomes.get(idx);
        if (conhecido === undefined) {
          nomes.set(idx, { nome: nomeLido, arquivos: new Set([letra]) });
        } else {
          conhecido.arquivos.add(letra);
          if (conhecido.nome !== nomeLido) {
            avisos.push({
              arquivo,
              linha: reg.linha,
              tipo: 'nome-divergente',
              detalhe: `${idx} aparece como "${nomeLido}"; mantido o primeiro nome lido, "${conhecido.nome}"`,
            });
          }
        }
      }

      const [menor, maior] = numero(idA) <= numero(idB) ? [idA, idB] : [idB, idA];
      const chave = `${menor}|${maior}`;
      const existente = pares.get(chave);
      if (existente === undefined) {
        pares.set(chave, {
          idA: menor,
          idB: maior,
          nivel,
          niveis: new Set([nivel]),
          origens: [{ arquivo, linha: reg.linha }],
        });
        continue;
      }
      rep.total++;
      if (existente.origens.some((o) => o.arquivo === arquivo)) {
        rep.mesmoArquivo++;
      } else {
        rep.outroArquivo++;
        existente.origens.push({ arquivo, linha: reg.linha });
      }
      if (!existente.niveis.has(nivel)) {
        const antes = existente.nivel;
        existente.niveis.add(nivel);
        if (ORDEM_GRAVIDADE[nivel] > ORDEM_GRAVIDADE[existente.nivel]) existente.nivel = nivel;
        avisos.push({
          arquivo,
          linha: reg.linha,
          tipo: 'nivel-conflitante',
          detalhe: `${menor} + ${maior}: nível ${nivel} aqui, ${antes} antes; mantido o mais grave, ${existente.nivel}`,
        });
      }
    }
  }

  const grau = new Map<string, number>();
  for (const p of pares.values()) {
    grau.set(p.idA, (grau.get(p.idA) ?? 0) + 1);
    grau.set(p.idB, (grau.get(p.idB) ?? 0) + 1);
  }

  const nomeDe = (idx: string): string => (nomes.get(idx) as { nome: string }).nome;
  const interacoes: Interacao[] = [...pares.values()]
    .sort((a, b) => numero(a.idA) - numero(b.idA) || numero(a.idB) - numero(b.idB))
    .map((p) => ({
      idA: p.idA,
      nomeA: nomeDe(p.idA),
      idB: p.idB,
      nomeB: nomeDe(p.idB),
      nivel: p.nivel,
      conflito:
        p.niveis.size > 1
          ? [...p.niveis].sort((x, y) => ORDEM_GRAVIDADE[y] - ORDEM_GRAVIDADE[x])
          : null,
      proveniencia: {
        fonte: FONTE_ID,
        versao: conjunto.versao,
        data: entrada.baixadoEm,
        origens: p.origens,
      },
    }));

  const farmacos: Farmaco[] = [...nomes.entries()]
    .sort(([a], [b]) => numero(a) - numero(b))
    .map(([idx, v]) => ({
      id: idx,
      nome: v.nome,
      arquivos: [...v.arquivos].sort(),
      interacoes: grau.get(idx) ?? 0,
    }));

  // ---- relatório ----
  const rejeitados: RelatorioQualidade['rejeitados'] = {
    total: rejeicoes.length,
    porCategoria: Object.fromEntries(CATEGORIAS.map((c) => [c, 0])),
    porColuna: {},
    amostra: [],
  };
  const vistasPorCategoria: Record<string, number> = {};
  for (const r of rejeicoes) {
    contar(rejeitados.porCategoria, r.categoria);
    if (r.categoria === 'esquema') {
      for (const m of r.motivos) contar(rejeitados.porColuna, m.split(':')[0] as string);
    }
    vistasPorCategoria[r.categoria] = (vistasPorCategoria[r.categoria] ?? 0) + 1;
    if ((vistasPorCategoria[r.categoria] as number) <= MAX_AMOSTRA) {
      rejeitados.amostra.push({
        arquivo: r.arquivo,
        linha: r.linha,
        categoria: r.categoria,
        motivos: r.motivos,
      });
    }
  }

  const avisosPorTipo: Record<string, number> = {};
  const amostraAvisos: Aviso[] = [];
  for (const a of avisos) {
    contar(avisosPorTipo, a.tipo);
    if ((avisosPorTipo[a.tipo] as number) <= MAX_AMOSTRA) amostraAvisos.push(a);
  }

  const niveis: Record<string, number> = Object.fromEntries(NIVEIS.map((n) => [n, 0]));
  const paresPorNumeroDeArquivos: Record<string, number> = {};
  const exclusivos = new Map<string, number>();
  const paresPorLetra = new Map<string, number>();
  for (const p of pares.values()) {
    contar(niveis, p.nivel);
    contar(paresPorNumeroDeArquivos, String(p.origens.length));
    for (const o of p.origens) {
      paresPorLetra.set(o.arquivo, (paresPorLetra.get(o.arquivo) ?? 0) + 1);
    }
    if (p.origens.length === 1) {
      const arq = (p.origens[0] as Origem).arquivo;
      exclusivos.set(arq, (exclusivos.get(arq) ?? 0) + 1);
    }
  }

  const suspeitos = farmacos.filter((f) => /[^\x20-\x7e]|\?/.test(f.nome));
  const faixas: Array<[string, (n: number) => boolean]> = [
    ['1 a 10', (n) => n <= 10],
    ['11 a 100', (n) => n > 10 && n <= 100],
    ['101 a 1000', (n) => n > 100 && n <= 1000],
    ['mais de 1000', (n) => n > 1000],
  ];
  const porNumeroDeInteracoes = Object.fromEntries(
    faixas.map(([rotulo, ok]) => [rotulo, farmacos.filter((f) => ok(f.interacoes)).length]),
  );

  const linhasLidas = [...porArquivo.values()].reduce((s, a) => s + a.linhas, 0);
  const relatorio: RelatorioQualidade = {
    fonte: {
      id: FONTE_ID,
      origem: entrada.origem ?? null,
      sha256: conjunto.sha256,
      versao: conjunto.versao,
      baixadoEm: entrada.baixadoEm,
    },
    arquivos: hashes.map((h) => {
      const arquivo = nomeArquivo(h.letra);
      const e = porArquivo.get(h.letra) as { linhas: number; rejeitadas: number };
      return {
        letra: h.letra,
        arquivo,
        sha256: h.sha256,
        bytes: h.bytes.byteLength,
        linhasLidas: e.linhas,
        rejeitadas: e.rejeitadas,
        pares: paresPorLetra.get(arquivo) ?? 0,
        exclusivos: exclusivos.get(arquivo) ?? 0,
      };
    }),
    linhasLidas,
    interacoesDistintas: interacoes.length,
    repetidas: rep,
    rejeitados,
    avisos: { total: avisos.length, porTipo: avisosPorTipo, amostra: amostraAvisos },
    niveis,
    paresPorNumeroDeArquivos,
    farmacos: {
      total: farmacos.length,
      suspeitaPerdaDeCaractere: {
        registros: suspeitos.length,
        exemplos: suspeitos.slice(0, MAX_AMOSTRA).map((f) => f.nome),
      },
      porNumeroDeInteracoes,
    },
  };
  return { interacoes, farmacos, rejeicoes, avisos, relatorio };
}
