import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { COLUNAS } from './schema.js';
import type { RelatorioQualidade, ResultadoProcessamento } from './processar.js';

const jsonl = (itens: readonly unknown[]): string =>
  itens.length === 0 ? '' : itens.map((i) => JSON.stringify(i)).join('\n') + '\n';

const pct = (n: number, total: number): string =>
  total === 0 ? '—' : `${((n / total) * 100).toFixed(1)}%`;

/** Valores do arquivo podem ter "|" ou quebra de linha; em tabela Markdown isso quebraria a linha. */
const celula = (v: string | number): string =>
  String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

const curto = (v: string, max = 60): string => (v.length > max ? `${v.slice(0, max - 1)}…` : v);

const tabela = (cabecalho: string[], linhas: Array<Array<string | number>>): string =>
  [
    `| ${cabecalho.join(' | ')} |`,
    `| ${cabecalho.map(() => '---').join(' | ')} |`,
    ...linhas.map((l) => `| ${l.map(celula).join(' | ')} |`),
  ].join('\n');

const distribuicao = (rotulo: string, d: Record<string, number>, coluna = 'Registros'): string =>
  Object.keys(d).length === 0 ? 'Nenhum.' : tabela([rotulo, coluna], Object.entries(d));

export function relatorioEmMarkdown(r: RelatorioQualidade): string {
  const { fonte, rejeitados, avisos, duplicadasExatas, principioAtivo } = r;
  const rep = r.mesmoNumeroRegistro;
  const { todos, ativos } = principioAtivo;
  const limite = principioAtivo.limiteObservado;
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
      ['Linhas de dados lidas', 'Registros distintos válidos', 'Duplicadas exatas', 'Rejeitadas'],
      [[r.linhasLidas, r.registrosValidos, duplicadasExatas.total, rejeitados.total]],
    ),
    `As linhas lidas são a soma das três últimas colunas. Duplicada exata é cópia idêntica de outra linha: foi colapsada e não é erro. Dos registros válidos, ${avisos.total} têm aviso (ver abaixo).`,
    '## Rejeições',
    rejeitados.total === 0
      ? 'Nenhuma linha rejeitada.'
      : [
          distribuicao('Categoria', rejeitados.porCategoria),
          '### Por coluna (esquema)',
          distribuicao('Coluna', rejeitados.porColuna),
          `### Amostra: ${rejeitados.amostra.length} de ${rejeitados.total}, até 10 por categoria (lista completa em \`rejeicoes.jsonl\`)`,
          tabela(
            ['Linha', 'Categoria', 'Motivos'],
            rejeitados.amostra.map((a) => [a.linha, a.categoria, a.motivos.join('; ')]),
          ),
        ].join('\n\n'),
    '## Avisos',
    avisos.total === 0
      ? 'Nenhum aviso.'
      : [
          'Campos informativos com formato inesperado. O registro foi mantido com o campo vazio; o valor original está em `avisos.jsonl`.',
          distribuicao('Coluna', avisos.porColuna),
          '### Formato do valor (dígitos trocados por N)',
          distribuicao('Coluna: formato', avisos.porPadrao),
          `### Amostra: ${avisos.amostra.length} de ${avisos.total}`,
          tabela(
            ['Linha', 'Coluna', 'Valor original'],
            avisos.amostra.map((a) => [a.linha, a.coluna, `\`${a.valor}\``]),
          ),
        ].join('\n\n'),
    '## Duplicadas exatas',
    duplicadasExatas.total === 0
      ? 'Nenhuma.'
      : [
          `${duplicadasExatas.total} linhas são cópia idêntica de uma linha anterior. Exemplos:`,
          tabela(
            ['Linha', 'Igual à linha'],
            duplicadasExatas.exemplos.map((e) => [e.linha, e.igualALinha]),
          ),
        ].join('\n\n'),
    '## Campos vazios (entre os registros válidos)',
    tabela(
      ['Coluna', 'Vazios', '% dos válidos'],
      COLUNAS.map((c) => [c, r.nulosPorColuna[c], pct(r.nulosPorColuna[c], r.registrosValidos)]),
    ),
    '## Suspeita de perda de caractere',
    'Valores com "?" ou "�": a origem pode ter perdido acentos antes de exportar. Não são corrigidos.',
    distribuicao('Coluna', r.suspeitaPerdaDeCaractere),
    '## Princípio ativo',
    tabela(
      ['Item', 'Todos os registros', 'Só ativos'],
      [
        ['Registros', r.registrosValidos, ativos.total],
        ['Sem princípio ativo', todos.semPrincipioAtivo, ativos.semPrincipioAtivo],
        [
          `Com ${limite} caracteres ou mais (possível corte pela ANVISA)`,
          todos.possivelmenteTruncado,
          ativos.possivelmenteTruncado,
        ],
      ],
    ),
    `Entre os ativos, ${pct(ativos.semPrincipioAtivo, ativos.total)} não têm princípio ativo e não podem ser analisados.`,
    '## Repetição de número de registro',
    `${rep.numerosRepetidos} número(s) de registro aparecem em mais de um registro distinto (${rep.registrosEnvolvidos} registros no total). Todos foram mantidos.`,
    rep.numerosRepetidos === 0
      ? ''
      : [
          '### O que muda entre os registros de mesmo número',
          distribuicao('Campos que diferem', rep.porCamposDiferentes, 'Números de registro'),
          `### Exemplos (${rep.exemplos.length})`,
          tabela(
            ['Número de registro', 'Linhas', 'Campos que diferem (valor em cada linha)'],
            rep.exemplos.map((e) => [
              e.numeroRegistro,
              e.linhas.join(', '),
              Object.entries(e.diferencas)
                .map(([campo, valores]) => `${campo}: ${valores.map((v) => curto(v)).join(' ↔ ')}`)
                .join('; '),
            ]),
          ),
        ].join('\n\n'),
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
