import { describe, expect, it } from 'vitest';
import { criarGlossario } from './glossario.js';
import { temErro, validarTraducao } from './validar.js';

const g = criarGlossario({
  versao: 1,
  termos: [
    { en: 'bleeding', pt: 'sangramento', status: 'aprovado' },
    { en: 'angioedema', pt: 'angioedema', status: 'proposto' },
  ],
});
const en = '[[F1]] may increase the risk of bleeding and angioedema in patients receiving [[F2]].';

describe('validarTraducao', () => {
  it('aceita tradução correta', () => {
    const p = validarTraducao(
      en,
      '[[F1]] pode aumentar o risco de sangramento e angioedema em pacientes que recebem [[F2]].',
      g,
    );
    expect(p).toEqual([]);
  });
  it('erro: tradução vazia, marcador perdido, repetido ou inventado', () => {
    expect(temErro(validarTraducao(en, '  ', g))).toBe(true);
    for (const pt of [
      '[[F1]] aumenta sangramento e angioedema com o outro fármaco.',
      '[[F1]] [[F1]] aumenta sangramento e angioedema com [[F2]].',
      '[[F1]] aumenta sangramento e angioedema com [[F2]] e [[F3]].',
    ]) {
      expect(validarTraducao(en, pt, g).some((x) => x.tipo === 'marcador')).toBe(true);
    }
  });
  it('glossário: termo aprovado ausente é erro; proposto ausente é aviso', () => {
    const p = validarTraducao(en, '[[F1]] aumenta a hemorragia e o inchaço em quem usa [[F2]].', g);
    expect(p.find((x) => x.detalhe.includes('bleeding'))?.gravidade).toBe('erro');
    expect(p.find((x) => x.detalhe.includes('angioedema'))?.gravidade).toBe('aviso');
  });
  it('avisa proporção muito diferente em textos longos', () => {
    const longo = 'x '.repeat(60);
    expect(validarTraducao(longo, 'curto', g).some((x) => x.tipo === 'proporcao')).toBe(true);
    expect(validarTraducao('short', 'curtinho', g)).toEqual([]);
  });
});
