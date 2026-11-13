import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { distribuicao, jsonl, pct, tabela } from './saida.js';
import { ErroArquivo, versaoDoConjunto } from './processar.js';
import {
  lerManifestoSite,
  nomeArquivoSite,
  processarSite,
  type RelatorioSite,
  type ResultadoSite,
  type ManifestoSite,
} from './site.js';

export function relatorioSiteEmMarkdown(r: RelatorioSite): string {
  const t = r.textosInteracao;
  const partes = [
    '# Relatório de qualidade: DDInter 2.0, exportações do site',
    tabela(
      ['Item', 'Valor'],
      [
        ['Versão do conjunto (SHA-256, 12 primeiros)', `\`${r.fonte.versao}\``],
        ['SHA-256 do conjunto', `\`${r.fonte.sha256}\``],
        ['Baixado em', r.fonte.baixadoEm],
        ['Origem', r.fonte.origem],
      ],
    ),
    '## Arquivos',
    tabela(
      ['Arquivo', 'Bytes', 'Linhas', 'Rejeitadas', 'Registros', 'SHA-256 (12)'],
      r.arquivos.map((a) => [
        a.arquivo,
        a.bytes,
        a.linhasLidas,
        a.rejeitadas,
        a.registros,
        `\`${a.sha256.slice(0, 12)}\``,
      ]),
    ),
    'Linhas lidas = registros + rejeitadas (+ cópias exatas, só na duplicidade terapêutica).',
    '## Limites destas exportações: leia antes de usar',
    '- Os textos das interações entre medicamentos (`severity_*`) **não trazem os medicamentos nem o id do par**: ligar texto a par exige a tabela de pares do site, que não está nestes arquivos.',
    '- Interações entre medicamentos **não têm campo de manejo** aqui; alimento tem `manejo` e doença traz um texto único.',
    '- A duplicidade terapêutica é de produto combinado contra medicamento isolado; não há lista de classes por medicamento.',
    '- A ausência de interação não significa segurança: o próprio DDInter avisa que a base é incompleta.',
    '## Textos de interação entre medicamentos',
    tabela(
      ['Item', 'Valor'],
      [
        ['Registros', t.total],
        ['Textos distintos', t.distintos],
        ['Faixa de id', `${t.idMinimo} a ${t.idMaximo}`],
        ['Ids ausentes na faixa', t.idsAusentes],
        ['Com mais de um mecanismo', t.comMaisDeUmMecanismo],
        ['Sem nenhum mecanismo', t.semMecanismo],
      ],
    ),
    distribuicao('Nível', t.porNivel, 'Textos'),
    distribuicao('Mecanismo marcado', t.porMecanismo, 'Textos'),
    '## Interações com alimentos',
    tabela(
      ['Item', 'Valor'],
      [
        ['Registros', r.alimentos.total],
        ['Medicamentos', r.alimentos.farmacos],
        ['Alimentos distintos', r.alimentos.alimentos],
        ['Medicamento + alimento com mais de um registro', r.alimentos.chavesRepetidas],
        ['… com níveis diferentes', r.alimentos.chavesComNiveisDiferentes],
      ],
    ),
    distribuicao('Nível', r.alimentos.porNivel, 'Registros'),
    distribuicao('Mecanismo (coluna `magnesium`)', r.alimentos.porMecanismo, 'Registros'),
    '## Interações com doenças',
    tabela(
      ['Item', 'Valor'],
      [
        ['Registros', r.doencas.total],
        ['Medicamentos', r.doencas.farmacos],
        ['Doenças distintas', r.doencas.doencas],
        ['Medicamento + doença com mais de um registro', r.doencas.chavesRepetidas],
        ['… linhas além da primeira', r.doencas.linhasExtras],
        ['… com níveis diferentes', r.doencas.chavesComNiveisDiferentes],
      ],
    ),
    'Mais de um registro para o mesmo medicamento e doença não é erro (cada um tem id e texto próprios); o motor da Fase 4 precisa decidir como mostrar.',
    distribuicao('Nível', r.doencas.porNivel, 'Registros'),
    '## Duplicidade terapêutica',
    tabela(
      ['Item', 'Valor'],
      [
        ['Registros', r.duplicidade.total],
        ['Produtos combinados', r.duplicidade.produtos],
        ['Classes', r.duplicidade.classes],
        ['Medicamentos', r.duplicidade.farmacos],
        ['Cópias exatas colapsadas', r.duplicidade.exatasRepetidas],
      ],
    ),
    '## Rejeições',
    r.rejeitados.total === 0
      ? 'Nenhuma linha rejeitada.'
      : [
          distribuicao('Categoria', r.rejeitados.porCategoria),
          tabela(
            ['Arquivo', 'Linha', 'Categoria', 'Motivos'],
            r.rejeitados.amostra.map((a) => [
              a.arquivo,
              a.linha,
              a.categoria,
              a.motivos.join('; '),
            ]),
          ),
        ].join('\n\n'),
    '## Avisos',
    r.avisos.total === 0
      ? 'Nenhum aviso.'
      : [
          'Registros mantidos com uma observação (lista completa em `avisos.jsonl`).',
          distribuicao('Tipo', r.avisos.porTipo),
          tabela(
            ['Arquivo', 'Linha', 'Tipo', 'Detalhe'],
            r.avisos.amostra.map((a) => [a.arquivo, a.linha, a.tipo, a.detalhe]),
          ),
        ].join('\n\n'),
    '## Medicamentos citados',
    `${r.farmacos.distintos} identificadores DDInter distintos nos arquivos de alimento, doença e duplicidade. Nomes diferentes para o mesmo identificador: ${r.farmacos.nomesDivergentes.length}.` +
      (r.farmacos.nomesDivergentes.length === 0
        ? ''
        : '\n\n' +
          tabela(
            ['Id', 'Nomes'],
            r.farmacos.nomesDivergentes.map((n) => [n.id, n.nomes.join(' / ')]),
          )),
    '## Suspeita de perda de caractere',
    Object.keys(r.suspeitaPerdaDeCaractere).length === 0
      ? 'Nenhuma.'
      : 'Registros com "?" ou "�" no campo. Nas referências isso é perda de acento da origem; não é corrigido.\n\n' +
        tabela(['Arquivo.campo', 'Registros'], Object.entries(r.suspeitaPerdaDeCaractere)),
    r.alimentos.total > 0
      ? `Cobertura: ${pct(r.alimentos.farmacos, r.farmacos.distintos)} dos medicamentos citados têm alimento.`
      : '',
  ];
  return partes.filter((p) => p !== '').join('\n\n') + '\n';
}

export function serializarSite(res: ResultadoSite): Record<string, string> {
  return {
    'textos-interacao.jsonl': jsonl(res.textos),
    'alimentos.jsonl': jsonl(res.alimentos),
    'doencas.jsonl': jsonl(res.doencas),
    'duplicidade.jsonl': jsonl(res.duplicidade),
    'rejeicoes.jsonl': jsonl(res.rejeicoes),
    'avisos.jsonl': jsonl(res.avisos),
    'relatorio-qualidade.json': JSON.stringify(res.relatorio, null, 2) + '\n',
    'relatorio-qualidade.md': relatorioSiteEmMarkdown(res.relatorio),
  };
}

export interface ResultadoExecucaoSite {
  manifesto: ManifestoSite;
  diretorioSaida: string;
  arquivosGerados: string[];
  resultado: ResultadoSite;
}

/** Confere checksums e processa uma importação já guardada, gravando em `<saida>/<sha12>/`. */
export function processarSiteGuardado(
  diretorioBruto: string,
  saida: string,
): ResultadoExecucaoSite {
  const manifesto = lerManifestoSite(diretorioBruto);
  const arquivos = manifesto.arquivos.map((m) => {
    try {
      return { tipo: m.tipo, bytes: readFileSync(join(diretorioBruto, nomeArquivoSite(m.tipo))) };
    } catch {
      throw new ErroArquivo(`arquivo ${m.arquivo} não encontrado ao lado do manifesto`);
    }
  });
  const resultado = processarSite({ arquivos, baixadoEm: manifesto.baixadoEm });
  for (const m of manifesto.arquivos) {
    const lido = resultado.relatorio.arquivos.find((a) => a.tipo === m.tipo);
    if (lido?.sha256 !== m.sha256) {
      throw new ErroArquivo(
        `checksum de ${m.arquivo} não confere: manifesto diz ${m.sha256.slice(0, 12)}, o arquivo tem ${lido?.sha256.slice(0, 12) ?? '(ausente)'}`,
      );
    }
  }
  if (
    versaoDoConjunto(manifesto.arquivos.map((a) => ({ letra: a.tipo, sha256: a.sha256 })))
      .sha256 !== manifesto.sha256
  ) {
    throw new ErroArquivo(
      'o checksum do conjunto no manifesto não bate com o dos arquivos listados',
    );
  }
  const diretorioSaida = join(saida, resultado.relatorio.fonte.versao);
  mkdirSync(diretorioSaida, { recursive: true });
  const conteudo = serializarSite(resultado);
  for (const [nome, texto] of Object.entries(conteudo))
    writeFileSync(join(diretorioSaida, nome), texto, 'utf8');
  return { manifesto, diretorioSaida, arquivosGerados: Object.keys(conteudo), resultado };
}
