import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { executar } from './cli.js';
import { arquivo, conjuntoEstritoValido, parMedicamento } from './fixtures.js';

const comConteudo = (valor: unknown) => () => JSON.stringify(valor);

describe('executar', () => {
  it('devolve 2 e o uso quando faltam argumentos ou há opção desconhecida', () => {
    expect(executar([]).codigo).toBe(2);
    expect(executar(['a.json', 'b.json']).codigo).toBe(2);
    expect(executar(['--rapido', 'a.json']).codigo).toBe(2);
  });

  it('devolve 2 quando o arquivo não existe ou não é JSON', () => {
    const inexistente = executar(['nao-existe.json'], () => {
      throw new Error('ENOENT');
    });
    expect(inexistente.codigo).toBe(2);
    expect(inexistente.linhas[0]).toContain('nao-existe.json');
    expect(executar(['a.json'], () => '{quebrado').codigo).toBe(2);
  });

  it('devolve 0 para um conjunto válido e 1 para um inválido', () => {
    expect(executar(['a.json'], comConteudo(arquivo([parMedicamento(1)]))).codigo).toBe(0);
    const ruim = executar(['a.json'], comConteudo(arquivo([parMedicamento(1, { id: 'X' })])));
    expect(ruim.codigo).toBe(1);
    expect(ruim.linhas.join('\n')).toContain('✗ pares.0.id');
  });

  it('o modo estrito aceita 30 pares válidos e rejeita o arquivo vazio', () => {
    const bom = executar(['--estrito', 'a.json'], comConteudo(arquivo(conjuntoEstritoValido())));
    expect(bom.codigo).toBe(0);
    expect(executar(['--estrito', 'a.json'], comConteudo(arquivo([]))).codigo).toBe(1);
  });

  it('o arquivo de dados versionado no repositório é válido no modo normal', () => {
    const caminho = fileURLToPath(
      new URL('../../../data/reference-set/pairs.json', import.meta.url),
    );
    const saida = executar([caminho], (c) => readFileSync(c, 'utf8'));
    expect(saida.linhas.join('\n')).toContain('OK');
    expect(saida.codigo).toBe(0);
  });
});
