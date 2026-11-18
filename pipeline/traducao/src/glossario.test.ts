import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  criarGlossario,
  lerGlossario,
  pluralDoTermo,
  termosAusentes,
  termosNoTexto,
} from './glossario.js';

const g = criarGlossario({
  versao: 1,
  termos: [
    { en: 'bleeding', pt: 'sangramento', status: 'aprovado' },
    { en: 'NSAID', pt: 'anti-inflamatório não esteroidal', aceitas: ['AINE'], status: 'proposto' },
    { en: 'beta-blocker', variantesEn: ['beta blocker'], pt: 'betabloqueador', status: 'proposto' },
  ],
});

describe('glossário', () => {
  it('acha termos por palavra inteira, com plural e variante', () => {
    expect(termosNoTexto('Increased bleeding with beta blockers.', g).map((t) => t.en)).toEqual([
      'bleeding',
      'beta-blocker',
    ]);
    expect(termosNoTexto('rebleedingx', g)).toHaveLength(0);
  });
  it('sigla só casa em maiúsculas', () => {
    expect(termosNoTexto('NSAIDs and others', g)).toHaveLength(1);
    expect(termosNoTexto('nsaid', g)).toHaveLength(0);
  });
  it('lista o termo cuja tradução não aparece, e aceita as formas alternativas', () => {
    expect(
      termosAusentes('NSAIDs cause bleeding.', 'Causam hemorragia.', g).map((t) => t.en),
    ).toEqual(['bleeding', 'NSAID']);
    expect(termosAusentes('NSAIDs cause bleeding.', 'AINEs causam sangramento.', g)).toHaveLength(
      0,
    );
  });
  it('aceita o plural regular do termo em português', () => {
    expect(pluralDoTermo('concentração plasmática')).toBe('concentrações plasmáticas');
    expect(pluralDoTermo('efeito adverso')).toBe('efeitos adversos');
    expect(pluralDoTermo('risco de sangramento')).toBe('riscos de sangramentos');
    const g2 = criarGlossario({
      versao: 1,
      termos: [{ en: 'plasma concentration', pt: 'concentração plasmática', status: 'proposto' }],
    });
    expect(
      termosAusentes('higher plasma concentrations', 'maiores concentrações plasmáticas', g2),
    ).toHaveLength(0);
    expect(termosAusentes('plasma concentrations', 'níveis no sangue', g2)).toHaveLength(1);
  });
  it('recusa termo repetido (inclusive por variante) e formato inválido', () => {
    expect(() =>
      criarGlossario({
        versao: 1,
        termos: [
          { en: 'a drug', pt: 'xx', status: 'proposto' },
          { en: 'other', variantesEn: ['A Drug'], pt: 'yy', status: 'proposto' },
        ],
      }),
    ).toThrow(/aparece em/);
    expect(() =>
      criarGlossario({ versao: 1, termos: [{ en: 'x', pt: 'y', status: 'ok' }] }),
    ).toThrow(/fora do formato/);
  });
  it('o id muda quando o conteúdo muda', () => {
    const h = criarGlossario({ versao: 2, termos: [] });
    expect(h.id).not.toBe(criarGlossario({ versao: 1, termos: [] }).id);
  });
  it('o glossário do repositório é válido e sem termo aprovado sem revisão', () => {
    const caminho = join(
      fileURLToPath(new URL('.', import.meta.url)),
      '..',
      '..',
      '..',
      'data',
      'traducao',
      'glossario.json',
    );
    const real = lerGlossario(caminho);
    expect(real.termos.length).toBeGreaterThan(100);
    // todo termo começa como proposta: aprovar é decisão da farmacêutica (P9)
    expect(real.termos.filter((t) => t.status === 'aprovado')).toHaveLength(0);
    for (const t of real.termos) expect(t.pt.trim()).toBe(t.pt);
  });
});
