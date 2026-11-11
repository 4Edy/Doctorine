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
 * Tamanho em que a ANVISA parece cortar o texto de PRINCIPIO_ATIVO (na amostra de 2026-11-11 o
 * maior valor tem exatamente 380 caracteres e termina no meio de uma palavra). Valores nesse
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

export type CategoriaRejeicao = 'csv-malformado' | 'colunas' | 'esquema' | 'duplicada-exata';

export interface Rejeicao {
  linha: number;
  categoria: CategoriaRejeicao;
  motivos: string[];
  /** Campos como vieram no arquivo, para conferir à mão. */
  bruto: string[];
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
  /** Linhas de dados lidas (sem o cabeçalho). Sempre = registrosValidos + rejeitados.total. */
  linhasLidas: number;
  registrosValidos: number;
  rejeitados: {
    total: number;
    porCategoria: Record<string, number>;
    /** Coluna citada nos motivos de esquema; uma linha com dois problemas conta nas duas. */
    porColuna: Record<string, number>;
    /** As primeiras 20, em ordem de linha. A lista completa está em rejeicoes.jsonl. */
    amostra: Array<Pick<Rejeicao, 'linha' | 'categoria' | 'motivos'>>;
  };
  /** Contagem de campos vazios entre os registros válidos. */
  nulosPorColuna: Record<Coluna, number>;
  duplicados: {
    /** Linhas idênticas a outra anterior (removidas do resultado). */
    exatas: number;
    /** Registros válidos distintos que repetem o NUMERO_REGISTRO_PRODUTO (mantidos). */
    mesmoNumeroRegistro: {
      numerosRepetidos: number;
      registrosEnvolvidos: number;
      exemplos: Array<{ numeroRegistro: string; linhas: number[] }>;
    };
  };
  principioAtivo: {
    semPrincipioAtivo: number;
    limiteObservado: number;
    possivelmenteTruncado: number;
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
  relatorio: RelatorioQualidade;
}

const AMOSTRA_REJEICOES = 20;
const EXEMPLOS_DUPLICADOS = 10;

function contar(valores: Iterable<string>): Record<string, number> {
  const m = new Map<string, number>();
  for (const v of valores) m.set(v, (m.get(v) ?? 0) + 1);
  return ordenado([...m.entries()]);
}

/** Mais frequentes primeiro; empate pela ordem alfabética, para a saída não oscilar. */
function ordenado(pares: Array<[string, number]>): Record<string, number> {
  return Object.fromEntries(
    pares.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
  );
}

/**
 * Lê o arquivo inteiro e devolve registros, rejeições e o relatório. É uma função pura dos bytes
 * e da entrada: mesma entrada, mesma saída, byte a byte.
 */
export function processar(entrada: EntradaArquivo): ResultadoProcessamento {
  const sha256 = createHash('sha256').update(entrada.bytes).digest('hex');
  const versao = sha256.slice(0, 12);
  const { texto, codificacao } = decodificar(entrada.bytes);

  const linhas = lerCsv(texto);
  const [cabecalho, ...dados] = linhas;
  if (cabecalho === undefined) throw new ErroArquivo('arquivo vazio');
  const problema = cabecalho.erro ?? conferirCabecalho(cabecalho.campos);
  if (problema !== null && problema !== undefined) throw new ErroArquivo(problema);

  const registros: RegistroProcessado[] = [];
  const rejeicoes: Rejeicao[] = [];
  const vistos = new Map<string, number>();
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
      rejeicoes.push({
        linha: l.linha,
        categoria: 'duplicada-exata',
        motivos: [`idêntica à linha ${primeira}`],
        bruto: l.campos,
      });
      continue;
    }
    vistos.set(chave, l.linha);
    if (v.registro.numeroRegistro !== null) {
      const lista = porNumero.get(v.registro.numeroRegistro) ?? [];
      lista.push(l.linha);
      porNumero.set(v.registro.numeroRegistro, lista);
    }
    registros.push({
      ...v.registro,
      proveniencia: { fonte: FONTE_ID, versao, data: entrada.baixadoEm, linha: l.linha },
    });
  }

  const nulosPorColuna = Object.fromEntries(
    COLUNAS.map((c) => [c, registros.filter((r) => r[CAMPO_DA_COLUNA[c]] === null).length]),
  ) as Record<Coluna, number>;

  const repetidos = [...porNumero.entries()].filter(([, ls]) => ls.length > 1);
  const porColuna = contar(
    rejeicoes
      .filter((r) => r.categoria === 'esquema')
      .flatMap((r) => r.motivos.map((m) => m.split(':', 1)[0] as string)),
  );

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
    rejeitados: {
      total: rejeicoes.length,
      porCategoria: contar(rejeicoes.map((r) => r.categoria)),
      porColuna,
      amostra: rejeicoes
        .slice(0, AMOSTRA_REJEICOES)
        .map(({ linha, categoria, motivos }) => ({ linha, categoria, motivos })),
    },
    nulosPorColuna,
    duplicados: {
      exatas: rejeicoes.filter((r) => r.categoria === 'duplicada-exata').length,
      mesmoNumeroRegistro: {
        numerosRepetidos: repetidos.length,
        registrosEnvolvidos: repetidos.reduce((soma, [, ls]) => soma + ls.length, 0),
        exemplos: repetidos
          .slice(0, EXEMPLOS_DUPLICADOS)
          .map(([numeroRegistro, ls]) => ({ numeroRegistro, linhas: ls })),
      },
    },
    principioAtivo: {
      semPrincipioAtivo: nulosPorColuna.PRINCIPIO_ATIVO,
      limiteObservado: LIMITE_PRINCIPIO_ATIVO,
      possivelmenteTruncado: registros.filter(
        (r) => (r.principioAtivo?.length ?? 0) >= LIMITE_PRINCIPIO_ATIVO,
      ).length,
    },
    distribuicoes: {
      tipoProduto: contar(registros.map((r) => r.tipoProduto)),
      situacaoRegistro: contar(registros.map((r) => r.situacaoRegistro)),
      categoriaRegulatoria: contar(registros.map((r) => r.categoriaRegulatoria ?? '(vazio)')),
    },
  };

  return { registros, rejeicoes, relatorio };
}
