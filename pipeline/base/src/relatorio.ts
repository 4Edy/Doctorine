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
        ['Regras do mapeamento automático (versão)', r.mapeamento.versaoRegras],
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
    'Em `mapeamento.componentes`, "descartados" são os componentes pendentes: ficam sem princípio ativo e o medicamento aparece como não verificado.',
    '## Mapeamento de princípios ativos (P7)',
    tabela(
      ['Item', 'Valor'],
      [
        ['Medicamentos ativos', r.mapeamento.cobertura.medicamentos.ativos],
        [
          'Ativos sem texto de princípio ativo (não analisáveis)',
          r.mapeamento.cobertura.medicamentos.ativosSemPrincipio,
        ],
        [
          'Ativos com todos os princípios ativos mapeados',
          `${r.mapeamento.cobertura.ativos.completos} de ${r.mapeamento.cobertura.medicamentos.ativosComTexto} (${r.mapeamento.cobertura.percentualCompletos}%)`,
        ],
        ['Ativos com alguns componentes pendentes', r.mapeamento.cobertura.ativos.parciais],
        ['Ativos sem nenhum componente mapeado', r.mapeamento.cobertura.ativos.nenhumMapeado],
        ['Ativos com texto cortado pela ANVISA', r.mapeamento.cobertura.ativos.comTextoCortado],
        ['Componentes distintos', r.mapeamento.cobertura.componentes.distintos],
        ['  automáticos', r.mapeamento.cobertura.componentes.automatico],
        ['  confirmados por decisão', r.mapeamento.cobertura.componentes.confirmado],
        ['  pendentes (fila de revisão)', r.mapeamento.cobertura.componentes.pendente],
        ['Princípios ativos canônicos', r.mapeamento.principios],
        [
          'Medicamentos do DDInter ligados a um princípio ativo',
          r.mapeamento.cobertura.farmacosLigados,
        ],
        ['Decisões lidas', r.mapeamento.decisoes],
        ['Princípios com nome repetido (deve ser 0)', r.verificacoes.principiosComNomeRepetido],
      ],
    ),
    'Cobertura = medicamentos ativos cujos componentes têm todos um princípio ativo, sobre os ativos que têm texto de princípio ativo. Um medicamento com componente pendente nunca vira "nenhuma ocorrência": o motor (P10) o mostra como não verificado.',
    '### Quanto a fila resolve',
    tabela(
      ['Se os primeiros N da fila forem resolvidos', 'Ativos completos'],
      r.mapeamento.cobertura.seResolvidos.map((x) => [x.primeiros, `${x.percentual}%`]),
    ),
    '### Sais e hidratos tirados no mapeamento automático',
    distribuicao('Regra', r.mapeamento.regrasDeSalUsadas, 'Componentes'),
    r.mapeamento.referencia.total === 0
      ? '### Conjunto de referência\n\nSem nomes de princípios ativos ainda (a farmacêutica não enviou os pares).'
      : [
          '### Conjunto de referência',
          distribuicao('Situação', r.mapeamento.referencia.porSituacao, 'Nomes'),
          r.mapeamento.referencia.semConfirmacao.length === 0
            ? 'Todos os nomes estão confirmados.'
            : r.mapeamento.referencia.semConfirmacao
                .map((x) => `- ${x.nome}: ${x.situacao}`)
                .join('\n'),
        ].join('\n\n'),
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
