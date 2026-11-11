import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validar } from './validate.js';

export interface SaidaCli {
  /** 0 = válido, 1 = conjunto inválido, 2 = uso incorreto ou arquivo ilegível. */
  codigo: 0 | 1 | 2;
  linhas: string[];
}

const USO = 'Uso: validate [--estrito] <arquivo.json>';

export function executar(
  argv: readonly string[],
  ler: (caminho: string) => string = (caminho) => readFileSync(caminho, 'utf8'),
): SaidaCli {
  const opcoes = argv.filter((arg) => arg.startsWith('--'));
  const caminhos = argv.filter((arg) => !arg.startsWith('--'));
  const desconhecidas = opcoes.filter((opcao) => opcao !== '--estrito');
  if (desconhecidas.length > 0 || caminhos.length !== 1 || caminhos[0] === undefined) {
    return { codigo: 2, linhas: [USO] };
  }
  const caminho = caminhos[0];
  const estrito = opcoes.includes('--estrito');

  let conteudo: unknown;
  try {
    conteudo = JSON.parse(ler(caminho));
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro);
    return { codigo: 2, linhas: [`Não foi possível ler ${caminho}: ${motivo}`] };
  }

  const resultado = validar(conteudo, { estrito });
  const linhas = resultado.problemas.map((p) => `✗ ${p.caminho}: ${p.mensagem}`);
  if (resultado.resumo !== null) {
    const { total, revisados, pendentes } = resultado.resumo;
    linhas.push(
      `Pares: ${total} (revisados: ${revisados}, pendentes: ${pendentes}) · modo ${estrito ? 'estrito' : 'normal'}`,
    );
  }
  linhas.push(resultado.ok ? 'OK' : `Falhou: ${resultado.problemas.length} problema(s)`);
  return { codigo: resultado.ok ? 0 : 1, linhas };
}

const entrada = process.argv[1];
if (entrada !== undefined && import.meta.url === pathToFileURL(entrada).href) {
  const saida = executar(process.argv.slice(2));
  console.log(saida.linhas.join('\n'));
  process.exit(saida.codigo);
}
