import { describe, expect, it } from 'vitest';
import { colors, dataState, severity, severityOrder, contraste } from './index.js';

const hex = /^#[0-9A-F]{6}$/;

describe('tokens', () => {
  it('todas as cores são hex de 6 dígitos', () => {
    const todas = [
      ...Object.values(colors),
      ...Object.values(severity).flatMap((s) => [s.fg, s.bg, s.border]),
      ...Object.values(dataState).flatMap((s) => [s.fg, s.bg]),
    ];
    for (const c of todas) expect(c).toMatch(hex);
  });

  it('mantém a ordem obrigatória de gravidade', () => {
    expect(severityOrder).toEqual([
      'contraindicada',
      'grave',
      'moderada',
      'leve',
      'indeterminada',
      'nenhuma',
    ]);
    expect(Object.keys(severity)).toEqual([...severityOrder]);
  });

  it('contraindicada e grave são distinguíveis por contraste entre si', () => {
    expect(contraste(severity.contraindicada.bg, severity.grave.bg)).toBeGreaterThanOrEqual(5);
  });

  it('gravidade nunca usa as cores da marca (rosa nem verde)', () => {
    const marca = [colors.blush, colors.sage, colors.medicinal, colors.medicinalStrong];
    for (const s of Object.values(severity)) {
      for (const c of [s.fg, s.bg, s.border]) expect(marca).not.toContain(c);
    }
  });
});

describe('contraste de texto (AA, 4,5:1)', () => {
  const fundos = [colors.ivory, colors.warmWhite, colors.blush, colors.lavender, colors.mist];
  it.each([
    ['charcoal', colors.charcoal],
    ['plum', colors.plum],
    ['textMuted', colors.textMuted],
  ])('%s em todos os fundos da marca', (_nome, fg) => {
    for (const bg of fundos) expect(contraste(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('texto branco sobre a cor de ação', () => {
    expect(contraste(colors.onAction, colors.medicinalStrong)).toBeGreaterThanOrEqual(4.5);
  });

  it('cor de ação como texto só em fundos claros neutros', () => {
    for (const bg of [colors.ivory, colors.warmWhite]) {
      expect(contraste(colors.medicinalStrong, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('gravidade e estados de dado: fg sobre bg', () => {
    for (const s of Object.values(severity))
      expect(contraste(s.fg, s.bg)).toBeGreaterThanOrEqual(4.5);
    for (const s of Object.values(dataState))
      expect(contraste(s.fg, s.bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('contraste de componentes (3:1, WCAG 1.4.11)', () => {
  it('borda de controle sobre os fundos de tela e cartão', () => {
    for (const bg of [colors.ivory, colors.warmWhite, colors.mist]) {
      expect(contraste(colors.borderStrong, bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it('ícones da marca (medicinal) sobre ivory', () => {
    expect(contraste(colors.medicinal, colors.ivory)).toBeGreaterThanOrEqual(3);
  });

  it('documenta que a borda decorativa NÃO serve para controles', () => {
    expect(contraste(colors.roseGray, colors.ivory)).toBeLessThan(3);
  });
});
