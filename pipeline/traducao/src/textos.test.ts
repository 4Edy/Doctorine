import { describe, expect, it } from 'vitest';
import {
  extrairUnidades,
  idDoTexto,
  normalizarTexto,
  versaoDasUnidades,
  type EntradaTextos,
} from './textos.js';

const entrada: EntradaTextos = {
  textos: [
    { id: 1, nivel: 'Minor', texto: 'Text  A.' },
    { id: 2, nivel: 'Major', texto: 'Text A.' },
    { id: 3, nivel: 'Moderate', texto: null },
    { id: 4, nivel: 'Moderate', texto: 'Text C.' },
  ],
  manejo: [
    { idTexto: 1, interacao: 'ignorada, a exportação tem o texto', manejo: 'Monitor.' },
    { idTexto: 3, interacao: 'Text from page.', manejo: 'Monitor.' },
    { idTexto: 99, interacao: null, manejo: null },
  ],
  alimentos: [{ id: 7, nivel: 'Minor', mecanismo: null, interacao: 'Text C.', manejo: 'Avoid.' }],
  doencas: [{ id: 5, nivel: 'Major', texto: 'Monitor.' }],
};

describe('extrairUnidades', () => {
  const u = extrairUnidades(entrada);
  const por = (en: string) => u.find((x) => x.en === en);

  it('junta textos iguais após normalizar espaços e guarda todos os usos', () => {
    expect(normalizarTexto(' a \n b ')).toBe('a b');
    expect(por('Text A.')?.usos.map((x) => x.chave)).toEqual(['texto:1', 'texto:2']);
    expect(por('Monitor.')?.usos).toHaveLength(3); // dois manejos + uma doença
  });
  it('a prioridade é a do uso mais grave', () => {
    expect(por('Text A.')?.prioridade).toBe(0);
    expect(por('Monitor.')?.prioridade).toBe(0); // doença Major
    expect(por('Text C.')?.prioridade).toBe(1);
    expect(por('Avoid.')?.prioridade).toBe(2);
  });
  it('a descrição da página só entra quando a exportação não tem o texto', () => {
    expect(por('Text from page.')).toBeDefined();
    expect(u.some((x) => x.en.startsWith('ignorada'))).toBe(false);
  });
  it('ordena do mais grave ao menos grave e ignora textos nulos', () => {
    expect(u.map((x) => x.prioridade)).toEqual([...u.map((x) => x.prioridade)].sort());
    expect(u.every((x) => x.en !== '')).toBe(true);
  });
  it('o id depende só do inglês normalizado; a versão não depende da ordem', () => {
    expect(por('Text A.')?.id).toBe(idDoTexto('Text A.'));
    expect(versaoDasUnidades(u)).toBe(versaoDasUnidades([...u].reverse()));
  });
});
