import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { COLUNAS } from './schema.js';
import type { RelatorioQualidade, ResultadoProcessamento } from './processar.js';

const jsonl = (itens: readonly unknown[]): string =>
  itens.length === 0 ? '' : itens.map((i) => JSON.stringify(i)).join('\n') + '\n';

const pct = (n: number, total: number): string =>
  total === 0 ? '—' : `${((n / total) * 100).toFixed(1)}%`;

const tabela = (cabecalho: string[], linhas: Array<Array<string | number>>): string =>
  [
    `| ${cabecalho.join(' | ')} |`,
    `| ${cabecalho.map(() => '---').join(' | ')} |`,
    ...linhas.map((l) => `| ${l.join(' | ')} |`),
  ].join('\n');

const distribuicao = (rotulo: string, d: Record<string, number>): string =>
  tabela([rotulo, 'Registros'], Object.entries(d));

export function relatorioEmMarkdown(r: RelatorioQualidade): string {
  const { fonte, rejeitados, duplicados, principioAtivo } = r;
  const rep = duplicados.mesmoNumeroRegistro;
  const partes = [
    '# Relatório de qualidade: ANVISA, medicamentos registrados',
    tabela(
      ['Item', 'Valor'],
      [
        ['Arquivo', fonte.arquivo],
        ['Endereço', fonte.url ?? '(não informado)'],
        ['Versão (SHA-256, 12 primeiros)', `\`${fonte.versao}\``],
        ['SHA-256 completo', `\`${fonte.sha256}\``],
        ['Tamanho', `${fonte.bytes} bytes`],
        ['Baixado em', fonte.baixadoEm],
        ['Codificação', r.codificacao],
      ],
    ),
    '## Resumo',
    tabela(
      ['Linhas de dados lidas', 'Registros válidos', 'Rejeitadas', 'Duplicadas exatas'],
      [[r.linhasLidas, r.registrosValidos, rejeitados.total, duplicados.exatas]],
    ),
    '## Rejeições',
    rejeitados.total === 0
      ? 'Nenhuma linha rejeitada.'
      : [
          distribuicao('Categoria', rejeitados.porCategoria),
          '### Por coluna (esquema)',
          Object.keys(rejeitados.porColuna).length === 0
            ? 'Nenhuma.'
            : distribuicao('Coluna', rejeitados.porColuna),
          `### Amostra: ${rejeitados.amostra.length} de ${rejeitados.total} (lista completa em \`rejeicoes.jsonl\`)`,
          tabela(
            ['Linha', 'Categoria', 'Motivos'],
            rejeitados.amostra.map((a) => [a.linha, a.categoria, a.motivos.join('; ')]),
          ),
        ].join('\n\n'),
    '## Campos vazios (entre os registros válidos)',
    tabela(
      ['Coluna', 'Vazios', '% dos válidos'],
      COLUNAS.map((c) => [c, r.nulosPorColuna[c], pct(r.nulosPorColuna[c], r.registrosValidos)]),
    ),
    '## Princípio ativo',
    tabela(
      ['Item', 'Registros'],
      [
        ['Sem princípio ativo', principioAtivo.semPrincipioAtivo],
        [
          `Com ${principioAtivo.limiteObservado} caracteres ou mais (possível corte pela ANVISA)`,
          principioAtivo.possivelmenteTruncado,
        ],
      ],
    ),
    '## Repetição de número de registro',
    `${rep.numerosRepetidos} número(s) de registro aparecem em mais de um registro distinto (${rep.registrosEnvolvidos} registros no total). Todos foram mantidos.`,
    rep.exemplos.length === 0
      ? ''
      : tabela(
          ['Número de registro', 'Linhas'],
          rep.exemplos.map((e) => [e.numeroRegistro, e.linhas.join(', ')]),
        ),
    '## Distribuições (registros válidos)',
    distribuicao('Tipo de produto', r.distribuicoes.tipoProduto),
    distribuicao('Situação do registro', r.distribuicoes.situacaoRegistro),
    distribuicao('Categoria regulatória', r.distribuicoes.categoriaRegulatoria),
  ];
  return partes.filter((p) => p !== '').join('\n\n') + '\n';
}

/** Nome do arquivo → conteúdo. Separado da escrita em disco para poder comparar saídas nos testes. */
export function serializar(res: ResultadoProcessamento): Record<string, string> {
  return {
    'registros.jsonl': jsonl(res.registros),
    'rejeicoes.jsonl': jsonl(res.rejeicoes),
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
