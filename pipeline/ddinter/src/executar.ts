import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lerManifesto, NOME_MANIFESTO, type Manifesto } from './baixar.js';
import {
  ErroArquivo,
  processar,
  versaoDoConjunto,
  type ResultadoProcessamento,
} from './processar.js';
import { escrever } from './saida.js';

export interface ResultadoExecucao {
  manifesto: Manifesto;
  diretorioSaida: string;
  arquivosGerados: string[];
  resultado: ResultadoProcessamento;
}

/**
 * Processa um conjunto já guardado (`diretorioBruto` = pasta com os 8 CSVs e o manifesto) e grava a
 * saída em `<saida>/<sha12>/`. Confere o checksum de cada arquivo e do conjunto antes de ler:
 * arquivo alterado à mão ou corrompido é erro, não dado.
 */
export function processarDownload(diretorioBruto: string, saida: string): ResultadoExecucao {
  const manifesto = lerManifesto(diretorioBruto);
  const arquivos = manifesto.arquivos.map((m) => {
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(join(diretorioBruto, m.arquivo));
    } catch {
      throw new ErroArquivo(`arquivo ${m.arquivo} não encontrado ao lado de ${NOME_MANIFESTO}`);
    }
    return { letra: m.letra, bytes };
  });
  const resultado = processar({
    arquivos,
    baixadoEm: manifesto.baixadoEm,
    origem: manifesto.origem,
  });
  for (const m of manifesto.arquivos) {
    const lido = resultado.relatorio.arquivos.find((a) => a.letra === m.letra);
    if (lido?.sha256 !== m.sha256) {
      throw new ErroArquivo(
        `checksum de ${m.arquivo} não confere: manifesto diz ${m.sha256.slice(0, 12)}, o arquivo tem ${lido?.sha256.slice(0, 12) ?? '(ausente)'}`,
      );
    }
  }
  const esperado = versaoDoConjunto(manifesto.arquivos);
  if (esperado.sha256 !== manifesto.sha256) {
    throw new ErroArquivo(
      'o checksum do conjunto no manifesto não bate com o dos arquivos listados',
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
