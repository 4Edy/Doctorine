import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LETRAS_ESPERADAS } from './schema.js';
import type { RelatorioQualidade, ResultadoProcessamento } from './processar.js';

export const jsonl = (itens: readonly unknown[]): string =>
  itens.length === 0 ? '' : itens.map((i) => JSON.stringify(i)).join('\n') + '\n';

export const pct = (n: number, total: number): string =>
  total === 0 ? '—' : `${((n / total) * 100).toFixed(1)}%`;

export const celula = (v: string | number): string =>
  String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export const tabela = (cabecalho: string[], linhas: Array<Array<string | number>>): string =>
  [
    `| ${cabecalho.join(' | ')} |`,
    `| ${cabecalho.map(() => '---').join(' | ')} |`,
    ...linhas.map((l) => `| ${l.map(celula).join(' | ')} |`),
  ].join('\n');

export const distribuicao = (
  rotulo: string,
  d: Record<string, number>,
  coluna = 'Quantidade',
): string =>
  Object.keys(d).length === 0 ? 'Nenhum.' : tabela([rotulo, coluna], Object.entries(d));

export function relatorioEmMarkdown(r: RelatorioQualidade): string {
  const { fonte, rejeitados, avisos, repetidas } = r;
  const partes = [
    '# Relatório de qualidade: DDInter, interações medicamentosas',
    tabela(
      ['Item', 'Valor'],
      [
        ['Versão do conjunto (SHA-256, 12 primeiros)', `\`${fonte.versao}\``],
        ['SHA-256 do conjunto', `\`${fonte.sha256}\``],
        ['Baixado em', fonte.baixadoEm],
        ['Origem', fonte.origem ?? '(não informada)'],
      ],
    ),
    '## Resumo',
    tabela(
      ['Linhas de dados lidas', 'Interações distintas', 'Repetidas', 'Rejeitadas'],
      [[r.linhasLidas, r.interacoesDistintas, repetidas.total, rejeitados.total]],
    ),
    `As linhas lidas são a soma das três últimas colunas. Repetida é uma linha cujo par de medicamentos (sem considerar a ordem) já tinha sido lido: ${repetidas.mesmoArquivo} no mesmo arquivo e ${repetidas.outroArquivo} em outro. Não é erro, mas o par só conta uma vez. Dos ${r.farmacos.total} medicamentos, nenhum é descartado.`,
    '## Arquivos',
    tabela(
      [
        'Arquivo',
        'Bytes',
        'Linhas',
        'Rejeitadas',
        'Pares distintos',
        'Só neste arquivo',
        'SHA-256 (12)',
      ],
      r.arquivos.map((a) => [
        a.arquivo,
        a.bytes,
        a.linhasLidas,
        a.rejeitadas,
        a.pares,
        a.exclusivos,
        `\`${a.sha256.slice(0, 12)}\``,
      ]),
    ),
    '## Cobertura: leia antes de usar',
    `O DDInter distribui as interações em ${LETRAS_ESPERADAS.length} arquivos (${LETRAS_ESPERADAS.join(', ')}). Estes arquivos não são a base completa: pares em que nenhum dos dois medicamentos cai nessas letras podem não estar aqui, e a ausência de um par **não** significa que não há interação. Cada arquivo guarda só a classificação (\`Level\`): mecanismo, manejo, referências, alimentos e doenças não vêm nestes arquivos.`,
    '## Níveis (pares distintos)',
    tabela(
      ['Nível original', 'Pares', '%'],
      Object.entries(r.niveis).map(([n, q]) => [n, q, pct(q, r.interacoesDistintas)]),
    ),
    `O nível \`Unknown\` é a classificação original do DDInter para interação sem gravidade definida; não é ausência de interação.`,
    '### Em quantos arquivos o par aparece',
    distribuicao('Arquivos', r.paresPorNumeroDeArquivos, 'Pares'),
    '## Rejeições',
    rejeitados.total === 0
      ? 'Nenhuma linha rejeitada.'
      : [
          distribuicao('Categoria', rejeitados.porCategoria),
          '### Por coluna (esquema)',
          distribuicao('Coluna', rejeitados.porColuna),
          `### Amostra: ${rejeitados.amostra.length} de ${rejeitados.total}, até 10 por categoria (lista completa em \`rejeicoes.jsonl\`)`,
          tabela(
            ['Arquivo', 'Linha', 'Categoria', 'Motivos'],
            rejeitados.amostra.map((a) => [a.arquivo, a.linha, a.categoria, a.motivos.join('; ')]),
          ),
        ].join('\n\n'),
    '## Avisos',
    avisos.total === 0
      ? 'Nenhum aviso (nenhum par com níveis diferentes entre arquivos, nenhum medicamento com dois nomes).'
      : [
          'Registros mantidos com uma decisão tomada pelo pipeline (lista completa em `avisos.jsonl`).',
          distribuicao('Tipo', avisos.porTipo),
          tabela(
            ['Arquivo', 'Linha', 'Tipo', 'Detalhe'],
            avisos.amostra.map((a) => [a.arquivo, a.linha, a.tipo, a.detalhe]),
          ),
        ].join('\n\n'),
    '## Medicamentos',
    tabela(
      ['Item', 'Valor'],
      [['Medicamentos distintos (identificador DDInter)', r.farmacos.total]],
    ),
    distribuicao('Pares por medicamento', r.farmacos.porNumeroDeInteracoes, 'Medicamentos'),
    '### Suspeita de perda de caractere',
    `Nomes com "?" ou caractere fora de ASCII: ${r.farmacos.suspeitaPerdaDeCaractere.registros}. ` +
      (r.farmacos.suspeitaPerdaDeCaractere.exemplos.length === 0
        ? ''
        : `Exemplos: ${r.farmacos.suspeitaPerdaDeCaractere.exemplos.map((e) => `\`${e}\``).join(', ')}.`),
  ];
  return partes.filter((p) => p !== '').join('\n\n') + '\n';
}

/** Nome do arquivo → conteúdo. Separado da escrita em disco para poder comparar saídas nos testes. */
export function serializar(res: ResultadoProcessamento): Record<string, string> {
  return {
    'interacoes.jsonl': jsonl(res.interacoes),
    'farmacos.jsonl': jsonl(res.farmacos),
    'rejeicoes.jsonl': jsonl(res.rejeicoes),
    'avisos.jsonl': jsonl(res.avisos),
    'relatorio-qualidade.json': JSON.stringify(res.relatorio, null, 2) + '\n',
    'relatorio-qualidade.md': relatorioEmMarkdown(res.relatorio),
  };
}

export function escrever(diretorio: string, res: ResultadoProcessamento): string[] {
  mkdirSync(diretorio, { recursive: true });
  const arquivos = serializar(res);
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    writeFileSync(join(diretorio, nome), conteudo, 'utf8');
  }
  return Object.keys(arquivos);
}
