import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SHA = 'a'.repeat(64);
const relatorio = (versao: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    fonte: { id: 'teste', sha256: SHA, versao, baixadoEm: '2026-11-14', ...extra },
  });
const jsonl = (xs: unknown[]): string => xs.map((x) => JSON.stringify(x)).join('\n') + '\n';
const prov = { arquivo: 'severity_1.csv', linha: 2 };

/** Cria um `data/processed` mínimo, com o formato das saídas do P5, para os testes. */
export function criarProcessado(raiz: string): void {
  const escrever = (
    fonte: string,
    versao: string,
    extra: Record<string, unknown>,
    arq: Record<string, unknown[]>,
  ) => {
    const pasta = join(raiz, 'data', 'processed', fonte, versao);
    mkdirSync(pasta, { recursive: true });
    writeFileSync(join(pasta, 'relatorio-qualidade.json'), relatorio(versao, extra));
    for (const [nome, linhas] of Object.entries(arq))
      writeFileSync(join(pasta, nome), jsonl(linhas));
  };
  escrever(
    'ddinter',
    '111111111111',
    { origem: 'manual' },
    {
      'farmacos.jsonl': [
        { id: 'DDInter1237', nome: 'Moexipril' },
        { id: 'DDInter1630', nome: 'Sacubitril' },
        { id: 'DDInter9', nome: 'Warfarin' },
      ],
    },
  );
  escrever(
    'ddinter-pares',
    '222222222222',
    {},
    {
      'farmacos.jsonl': [{ id: 'DDInter50', drugbank: null, nome: 'Ethanol' }],
    },
  );
  escrever(
    'ddinter-site',
    '333333333333',
    { origem: 'manual' },
    {
      'textos-interacao.jsonl': [
        {
          id: 9,
          nivel: 'Major',
          texto:
            'Coadministration of Sacubitril with Moexipril may increase the risk of angioedema.',
          mecanismos: ['Synergy'],
          proveniencia: prov,
        },
        {
          id: 10,
          nivel: 'Minor',
          texto: 'Warfarin may cause bleeding when used with other drugs.',
          mecanismos: [],
          proveniencia: prov,
        },
      ],
      'alimentos.jsonl': [
        {
          id: 1,
          idFarmaco: 'DDInter9',
          farmaco: 'Warfarin',
          alimento: 'Alcohol',
          nivel: 'Moderate',
          mecanismo: null,
          interacao: 'Alcohol may increase the effect of Warfarin.',
          manejo: 'Monitor the INR.',
          referencias: null,
          proveniencia: prov,
        },
      ],
      'doencas.jsonl': [
        {
          id: 1,
          idFarmaco: 'DDInter9',
          farmaco: 'Warfarin',
          doenca: 'Liver disease',
          nivel: 'Moderate',
          texto: 'Monitor the INR.',
          referencias: null,
          proveniencia: prov,
        },
      ],
    },
  );
  escrever(
    'ddinter-manejo',
    '444444444444',
    {},
    {
      'textos-manejo.jsonl': [
        {
          idTexto: 9,
          idParLido: 110952,
          interacao: null,
          manejo: 'Avoid the combination.',
          referencias: [],
        },
        { idTexto: 10, idParLido: 5, interacao: null, manejo: 'Monitor the INR.', referencias: [] },
      ],
    },
  );
}
