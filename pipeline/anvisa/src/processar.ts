import { createHash } from 'node:crypto';
import { lerCsv } from './csv.js';
import { decodificar, type Codificacao } from './decodificar.js';
import {
  CAMPO_DA_COLUNA,
  COLUNAS,
  conferirCabecalho,
  validarLinha,
  type Coluna,
  type RegistroAnvisa,
} from './schema.js';

export const FONTE_ID = 'anvisa-dados-abertos-medicamentos';

/**
 * Tamanho em que a ANVISA corta o texto de PRINCIPIO_ATIVO (no arquivo completo de 2026-11-11, 81
 * registros têm exatamente 380 caracteres, terminando no meio de uma palavra). Valores nesse
 * tamanho são sinalizados no relatório, nunca corrigidos.
 */
export const LIMITE_PRINCIPIO_ATIVO = 380;

/** Falha do arquivo inteiro (vazio, cabeçalho diferente, checksum que não bate). */
export class ErroArquivo extends Error {
  override name = 'ErroArquivo';
}

export interface EntradaArquivo {
  bytes: Uint8Array;
  /** Nome do arquivo na origem. */
  arquivo: string;
  /** AAAA-MM-DD, vem do manifesto do download (nunca do relógio, para o resultado ser repetível). */
  baixadoEm: string;
  url?: string;
}

export interface Proveniencia {
  fonte: string;
  /** Primeiros 12 caracteres do SHA-256 do arquivo de origem. */
  versao: string;
  /** AAAA-MM-DD do download. */
  data: string;
  /** Linha do arquivo de origem (base 1, o cabeçalho é a linha 1). */
  linha: number;
}

export interface RegistroProcessado extends RegistroAnvisa {
  proveniencia: Proveniencia;
}

/** Linha que não virou registro. Cópia exata de outra linha não entra aqui (ver duplicadasExatas). */
export type CategoriaRejeicao = 'csv-malformado' | 'colunas' | 'esquema';
const CATEGORIAS: readonly CategoriaRejeicao[] = ['csv-malformado', 'colunas', 'esquema'];

export interface Rejeicao {
  linha: number;
  categoria: CategoriaRejeicao;
  motivos: string[];
  /** Campos como vieram no arquivo, para conferir à mão. */
  bruto: string[];
}

/** Campo informativo com formato inesperado: o registro foi mantido com o campo vazio. */
export interface AvisoRegistro {
  linha: number;
  coluna: string;
  valor: string;
  motivo: string;
}

export interface RelatorioQualidade {
  fonte: {
    id: string;
    arquivo: string;
    url: string | null;
    sha256: string;
    versao: string;
    bytes: number;
    baixadoEm: string;
  };
  codificacao: Codificacao;
  /** Linhas de dados lidas (sem o cabeçalho) = registrosValidos + duplicadasExatas.total + rejeitados.total. */
  linhasLidas: number;
  /** Registros distintos que passaram na validação. */
  registrosValidos: number;
  /** Linhas idênticas a outra anterior (colapsadas, não são erro). */
  duplicadasExatas: {
    total: number;
    exemplos: Array<{ linha: number; igualALinha: number }>;
  };
  rejeitados: {
    total: number;
    porCategoria: Record<string, number>;
    /** Coluna citada nos motivos de esquema; uma linha com dois problemas conta nas duas. */
    porColuna: Record<string, number>;
    /** Até 10 por categoria, em ordem de linha. A lista completa está em rejeicoes.jsonl. */
    amostra: Array<Pick<Rejeicao, 'linha' | 'categoria' | 'motivos'>>;
  };
  avisos: {
    total: number;
    porColuna: Record<string, number>;
    /** Formato do valor com dígitos trocados por N (ex.: "NNNNN"), por coluna. */
    porPadrao: Record<string, number>;
    /** As primeiras 10. A lista completa está em avisos.jsonl. */
    amostra: AvisoRegistro[];
  };
  /** Contagem de campos vazios entre os registros válidos. */
  nulosPorColuna: Record<Coluna, number>;
  /** Valores com "?" ou caractere de substituição: a origem pode ter perdido acentos. */
  suspeitaPerdaDeCaractere: Record<string, number>;
  /** Registros distintos que repetem o NUMERO_REGISTRO_PRODUTO (todos mantidos). */
  mesmoNumeroRegistro: {
    numerosRepetidos: number;
    registrosEnvolvidos: number;
    /** Quais campos diferem dentro de cada grupo de repetidos. */
    porCamposDiferentes: Record<string, number>;
    exemplos: Array<{
      numeroRegistro: string;
      linhas: number[];
      diferencas: Record<string, string[]>;
    }>;
  };
  principioAtivo: {
    limiteObservado: number;
    todos: { semPrincipioAtivo: number; possivelmenteTruncado: number };
    /** Só registros com SITUACAO_REGISTRO = "Ativo": são os que limitam a cobertura do app. */
    ativos: { total: number; semPrincipioAtivo: number; possivelmenteTruncado: number };
  };
  distribuicoes: {
    tipoProduto: Record<string, number>;
    situacaoRegistro: Record<string, number>;
    categoriaRegulatoria: Record<string, number>;
  };
}

export interface ResultadoProcessamento {
  registros: RegistroProcessado[];
  rejeicoes: Rejeicao[];
  avisos: AvisoRegistro[];
  relatorio: RelatorioQualidade;
}

const POR_CATEGORIA = 10;
const AMOSTRA_AVISOS = 10;
const EXEMPLOS = 10;
const CAMPOS = COLUNAS.map((c) => CAMPO_DA_COLUNA[c]);
const CAMPOS_DE_TEXTO: Coluna[] = [
  'NOME_PRODUTO',
  'CATEGORIA_REGULATORIA',
  'CLASSE_TERAPEUTICA',
  'PRINCIPIO_ATIVO',
];

/** Mais frequentes primeiro; empate pela ordem alfabética, para a saída não oscilar. */
function ordenado(pares: Array<[string, number]>): Record<string, number> {
  return Object.fromEntries(
    pares.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
  );
}

function contar(valores: Iterable<string>): Record<string, number> {
  const m = new Map<string, number>();
  for (const v of valores) m.set(v, (m.get(v) ?? 0) + 1);
  return ordenado([...m.entries()]);
}

const padrao = (valor: string): string => valor.replace(/\d/g, 'N');
const suspeito = (v: string | null): boolean => v !== null && /[?�]/.test(v);
const texto = (v: unknown): string =>
  v === null ? '(vazio)' : typeof v === 'string' ? v : JSON.stringify(v);

function diferencas(grupo: RegistroProcessado[]): Record<string, string[]> {
  const saida: Record<string, string[]> = {};
  for (const campo of CAMPOS) {
    if (new Set(grupo.map((r) => JSON.stringify(r[campo]))).size > 1) {
      saida[campo] = grupo.map((r) => texto(r[campo]));
    }
  }
  return saida;
}

/**
 * Lê o arquivo inteiro e devolve registros, rejeições, avisos e o relatório. É uma função pura dos
 * bytes e da entrada: mesma entrada, mesma saída, byte a byte.
 */
export function processar(entrada: EntradaArquivo): ResultadoProcessamento {
  const sha256 = createHash('sha256').update(entrada.bytes).digest('hex');
  const versao = sha256.slice(0, 12);
  const { texto: conteudo, codificacao } = decodificar(entrada.bytes);

  const linhas = lerCsv(conteudo);
  const [cabecalho, ...dados] = linhas;
  if (cabecalho === undefined) throw new ErroArquivo('arquivo vazio');
  const problema = cabecalho.erro ?? conferirCabecalho(cabecalho.campos);
  if (problema !== null && problema !== undefined) throw new ErroArquivo(problema);

  const registros: RegistroProcessado[] = [];
  const rejeicoes: Rejeicao[] = [];
  const avisos: AvisoRegistro[] = [];
  const vistos = new Map<string, number>();
  const exemplosDuplicadas: Array<{ linha: number; igualALinha: number }> = [];
  let duplicadas = 0;
  const porNumero = new Map<string, number[]>();

  for (const l of dados) {
    if (l.erro !== undefined) {
      rejeicoes.push({
        linha: l.linha,
        categoria: 'csv-malformado',
        motivos: [l.erro],
        bruto: l.campos,
      });
      continue;
    }
    const v = validarLinha(l.campos);
    if (!v.ok) {
      const categoria = l.campos.length !== COLUNAS.length ? 'colunas' : 'esquema';
      rejeicoes.push({ linha: l.linha, categoria, motivos: v.motivos, bruto: l.campos });
      continue;
    }
    const chave = JSON.stringify(v.registro);
    const primeira = vistos.get(chave);
    if (primeira !== undefined) {
      duplicadas++;
      if (exemplosDuplicadas.length < EXEMPLOS) {
        exemplosDuplicadas.push({ linha: l.linha, igualALinha: primeira });
      }
      continue;
    }
    vistos.set(chave, l.linha);
    for (const a of v.avisos) avisos.push({ linha: l.linha, ...a });
    if (v.registro.numeroRegistro !== null) {
      const indices = porNumero.get(v.registro.numeroRegistro) ?? [];
      indices.push(registros.length);
      porNumero.set(v.registro.numeroRegistro, indices);
    }
    registros.push({
      ...v.registro,
      proveniencia: { fonte: FONTE_ID, versao, data: entrada.baixadoEm, linha: l.linha },
    });
  }

  const nulosPorColuna = Object.fromEntries(
    COLUNAS.map((c) => [c, registros.filter((r) => r[CAMPO_DA_COLUNA[c]] === null).length]),
  ) as Record<Coluna, number>;

  const grupos = [...porNumero.entries()]
    .filter(([, indices]) => indices.length > 1)
    .map(([numeroRegistro, indices]) => ({
      numeroRegistro,
      registros: indices.map((i) => registros[i] as RegistroProcessado),
    }))
    .map((g) => ({ ...g, diferencas: diferencas(g.registros) }));

  const truncado = (r: RegistroProcessado): boolean =>
    (r.principioAtivo?.length ?? 0) >= LIMITE_PRINCIPIO_ATIVO;
  const ativos = registros.filter((r) => r.situacaoRegistro === 'Ativo');

  const relatorio: RelatorioQualidade = {
    fonte: {
      id: FONTE_ID,
      arquivo: entrada.arquivo,
      url: entrada.url ?? null,
      sha256,
      versao,
      bytes: entrada.bytes.byteLength,
      baixadoEm: entrada.baixadoEm,
    },
    codificacao,
    linhasLidas: dados.length,
    registrosValidos: registros.length,
    duplicadasExatas: { total: duplicadas, exemplos: exemplosDuplicadas },
    rejeitados: {
      total: rejeicoes.length,
      porCategoria: contar(rejeicoes.map((r) => r.categoria)),
      porColuna: contar(
        rejeicoes
          .filter((r) => r.categoria === 'esquema')
          .flatMap((r) => r.motivos.map((m) => m.split(':', 1)[0] as string)),
      ),
      amostra: CATEGORIAS.flatMap((c) =>
        rejeicoes
          .filter((r) => r.categoria === c)
          .slice(0, POR_CATEGORIA)
          .map(({ linha, categoria, motivos }) => ({ linha, categoria, motivos })),
      ),
    },
    avisos: {
      total: avisos.length,
      porColuna: contar(avisos.map((a) => a.coluna)),
      porPadrao: contar(avisos.map((a) => `${a.coluna}: ${padrao(a.valor)}`)),
      amostra: avisos.slice(0, AMOSTRA_AVISOS),
    },
    nulosPorColuna,
    suspeitaPerdaDeCaractere: Object.fromEntries(
      CAMPOS_DE_TEXTO.map((c) => [
        c,
        registros.filter((r) => suspeito(r[CAMPO_DA_COLUNA[c]] as string | null)).length,
      ]),
    ),
    mesmoNumeroRegistro: {
      numerosRepetidos: grupos.length,
      registrosEnvolvidos: grupos.reduce((soma, g) => soma + g.registros.length, 0),
      porCamposDiferentes: contar(grupos.map((g) => Object.keys(g.diferencas).join(', '))),
      exemplos: grupos.slice(0, EXEMPLOS).map((g) => ({
        numeroRegistro: g.numeroRegistro,
        linhas: g.registros.map((r) => r.proveniencia.linha),
        diferencas: g.diferencas,
      })),
    },
    principioAtivo: {
      limiteObservado: LIMITE_PRINCIPIO_ATIVO,
      todos: {
        semPrincipioAtivo: nulosPorColuna.PRINCIPIO_ATIVO,
        possivelmenteTruncado: registros.filter(truncado).length,
      },
      ativos: {
        total: ativos.length,
        semPrincipioAtivo: ativos.filter((r) => r.principioAtivo === null).length,
        possivelmenteTruncado: ativos.filter(truncado).length,
      },
    },
    distribuicoes: {
      tipoProduto: contar(registros.map((r) => r.tipoProduto)),
      situacaoRegistro: contar(registros.map((r) => r.situacaoRegistro)),
      categoriaRegulatoria: contar(registros.map((r) => r.categoriaRegulatoria ?? '(vazio)')),
    },
  };

  return { registros, rejeicoes, avisos, relatorio };
}
