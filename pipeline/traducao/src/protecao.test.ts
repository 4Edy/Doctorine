import { describe, expect, it } from 'vitest';
import { criarProtetor, marcadoresDe } from './protecao.js';

const nomes = [
  { id: 'DDInter1', nome: 'Abacavir' },
  { id: 'DDInter2', nome: 'Sacubitril' },
  { id: 'DDInter3', nome: 'Interferon alfa-2a' },
  { id: 'DDInter4', nome: 'Interferon' },
];

describe('protetor de nomes de fármacos', () => {
  it('troca cada nome por marcador, sem diferenciar maiúsculas', () => {
    const p = criarProtetor(nomes).proteger('Abacavir and sacubitril may interact.');
    expect(p.texto).toBe('[[F1]] and [[F2]] may interact.');
    expect(p.marcas.map((m) => m.idFarmaco)).toEqual(['DDInter1', 'DDInter2']);
  });
  it('prefere o nome mais longo e só casa palavra inteira', () => {
    const pr = criarProtetor(nomes);
    expect(pr.proteger('Interferon alfa-2a raises levels.').marcas[0]?.idFarmaco).toBe('DDInter3');
    expect(pr.proteger('Abacavirine is not a drug here.').marcas).toHaveLength(0);
  });
  it('nome entre hífens ainda é reconhecido', () => {
    expect(criarProtetor(nomes).proteger('sacubitril-valsartan').texto).toBe('[[F1]]-valsartan');
  });
  it('restaura com o nome em português do mapeamento, mantendo a maiúscula inicial', () => {
    const pr = criarProtetor(nomes);
    const p = pr.proteger('Sacubitril and abacavir.');
    const pt = new Map([
      ['DDInter1', 'abacavir'],
      ['DDInter2', 'sacubitrila'],
    ]);
    expect(pr.restaurar('[[F1]] e [[F2]].', p.marcas, pt)).toBe('Sacubitrila e abacavir.');
  });
  it('sem mapeamento volta o nome como estava', () => {
    const pr = criarProtetor(nomes);
    const p = pr.proteger('Sacubitril x Abacavir');
    expect(pr.restaurar('[[F1]] x [[F2]]', p.marcas)).toBe('Sacubitril x Abacavir');
  });
  it('lista de nomes vazia não muda o texto; marcadoresDe conta com repetição', () => {
    expect(criarProtetor([]).proteger('Abacavir').texto).toBe('Abacavir');
    expect(marcadoresDe('[[F2]] [[F1]] [[F2]]')).toEqual([1, 2, 2]);
  });
});
