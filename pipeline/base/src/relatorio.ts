import { distribuicao, pct, tabela } from '@doctorine/pipeline-ddinter';
import type { RelatorioCarga } from './carregar.js';

export function relatorioEmMarkdown(r: RelatorioCarga): string {
  const m = r.medicamento;
  const i = r.interacoes;
  const partes = [
    '# Relatório de carga: base SQLite do Doctorine',
    tabela(
      ['Item', 'Valor'],
      [
        ['Versão da base (depende só das versões das fontes)', `\`${r.base.versao}\``],
        ['Gerada a partir de dados até', r.base.geradaAPartirDe],
        ['Esquema', r.base.esquema],
        ['Arquivo', `${r.arquivo.nome} (${r.arquivo.bytes} bytes)`],
        ['SHA-256 do arquivo', `\`${r.arquivo.sha256}\``],
        [
          'integrity_check / foreign_key_check',
          `${r.verificacoes.integrityCheck} / ${r.verificacoes.foreignKeyCheck} problemas`,
        ],
      ],
    ),
    '## Fontes carregadas',
    tabela(
      ['Fonte', 'Versão', 'Baixada em', 'SHA-256 (12)'],
      r.fontes.map((f) => [
        f.fonte,
        `\`${f.versao}\``,
        f.baixadoEm,
        `\`${f.sha256.slice(0, 12)}\``,
      ]),
    ),
    '## A conta fecha',
    'Cada item lido vira uma linha gravada ou um descarte com motivo; a carga para se alguma conta não fechar.',
    tabela(
      ['Conjunto', 'Lidos', 'Gravados', 'Descartados'],
      Object.entries(r.contas).map(([nome, c]) => [nome, c.entrada, c.gravadas, c.descartados]),
    ),
    'Em `anvisa.registros`, vários registros do mesmo número viram um medicamento. Em `csv.interacoes`, um par que também está no site conta uma vez, mesmo com várias linhas do site.',
    '## Linhas por tabela',
    distribuicao('Tabela', r.tabelas, 'Linhas'),
    'As tabelas `principio_ativo`, `mapeamento` e `medicamento_principio` ficam vazias até o P7 (mapeamento de princípios ativos).',
    '## Medicamentos (ANVISA)',
    tabela(
      ['Item', 'Valor'],
      [
        ['Registros lidos', m.registrosLidos],
        ['Medicamentos gravados', m.medicamentos],
        ['Juntaram mais de um registro (mesmo número)', m.comMaisDeUmaLinha],
        ['Ativos (alguma linha ativa)', `${m.ativos} (${pct(m.ativos, m.medicamentos)})`],
        ['Sem número de registro', m.semNumeroDeRegistro],
        [
          'Sem princípio ativo',
          `${m.semPrincipioAtivo} (${pct(m.semPrincipioAtivo, m.medicamentos)})`,
        ],
      ],
    ),
    '### Campos que diferem entre os registros juntados',
    'Quando o mesmo número de registro tem valores diferentes, a carga fica com a linha ativa (ou a primeira); isto mostra o que foi deixado de lado.',
    distribuicao('Campo', m.camposDiferentesEntreLinhas, 'Medicamentos'),
    '## Medicamentos do DDInter',
    tabela(
      ['Item', 'Valor'],
      [
        ['Medicamentos', r.farmacos.total],
        ['Com DrugBank', r.farmacos.comDrugbank],
        ['Sem DrugBank', r.farmacos.semDrugbank],
      ],
    ),
    '## Interações entre medicamentos',
    tabela(
      ['Item', 'Valor'],
      [
        ['Linhas', i.total],
        ['Pares do site que também estão nos CSVs', i.emSiteECsv],
        ['Só no site', i.soSite],
        ['Só nos CSVs (sem texto; todos `Unknown`, ver docs/fontes/ddinter.md)', i.soCsv],
        ['Pares de medicamentos com mais de uma linha', i.paresComMaisDeUmaLinha],
      ],
    ),
    distribuicao('Gravidade padronizada', i.porGravidade, 'Linhas'),
    'Gravidade = a mais grave entre o nível do par no site e o do CSV; os dois níveis originais ficam gravados. O DDInter não tem "contraindicada".',
    '## Descartes',
    r.descartes.total === 0
      ? 'Nenhum.'
      : [
          distribuicao('Motivo', r.descartes.porMotivo),
          r.descartes.amostra.map((a) => `- ${a}`).join('\n'),
        ].join('\n\n'),
    '## Avisos',
    r.avisos.total === 0
      ? 'Nenhum.'
      : [
          distribuicao('Tipo', r.avisos.porTipo),
          r.avisos.amostra.map((a) => `- ${a}`).join('\n'),
        ].join('\n\n'),
  ];
  return partes.join('\n\n') + '\n';
}
