import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lerManifesto, NOME_MANIFESTO, type Manifesto } from './baixar.js';
import { ErroArquivo, processar, type ResultadoProcessamento } from './processar.js';
import { escrever } from './saida.js';

export interface ResultadoExecucao {
  manifesto: Manifesto;
  diretorioSaida: string;
  arquivosGerados: string[];
  resultado: ResultadoProcessamento;
}

/**
 * Processa um download já feito (`diretorioBruto` = pasta com o CSV e o manifesto) e grava a saída
 * em `<saida>/<sha12>/`. Confere o checksum do manifesto antes de ler: arquivo alterado à mão ou
 * corrompido é erro, não dado.
 */
export function processarDownload(diretorioBruto: string, saida: string): ResultadoExecucao {
  const manifesto = lerManifesto(diretorioBruto);
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(join(diretorioBruto, manifesto.arquivo));
  } catch {
    throw new ErroArquivo(
      `arquivo ${manifesto.arquivo} não encontrado ao lado de ${NOME_MANIFESTO}`,
    );
  }
  const resultado = processar({
    bytes,
    arquivo: manifesto.arquivo,
    baixadoEm: manifesto.baixadoEm,
    url: manifesto.url,
  });
  if (resultado.relatorio.fonte.sha256 !== manifesto.sha256) {
    throw new ErroArquivo(
      `checksum não confere: manifesto diz ${manifesto.sha256.slice(0, 12)}, o arquivo tem ${resultado.relatorio.fonte.versao}`,
    );
  }
  const diretorioSaida = join(saida, resultado.relatorio.fonte.versao);
  return {
    manifesto,
    diretorioSaida,
    arquivosGerados: escrever(diretorioSaida, resultado),
    resultado,
  };
}
