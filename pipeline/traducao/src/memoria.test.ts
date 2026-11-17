import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Memoria } from './memoria.js';

const ID = 'ab12cd34ef56ab12';
const meta = { modelo: 'm', glossario: 'g1', data: '2026-11-16' };
const novo = () => new Memoria(join(mkdtempSync(join(tmpdir(), 'mem-')), 'x', 'memoria.jsonl'));

describe('memória de tradução', () => {
  it('o rascunho entra como nao-revisado, com histórico por versão', () => {
    const m = novo();
    m.registrarRascunho(ID, 'um', meta);
    m.registrarRascunho(ID, 'dois', meta);
    expect(m.estado(ID)).toMatchObject({
      pt: 'dois',
      status: 'nao-revisado',
      origem: 'ia',
      seq: 2,
    });
    expect(m.historico(ID).map((e) => e.pt)).toEqual(['um', 'dois']);
  });
  it('aprovar vira revisado; corrigir com texto novo vira corrigido; igual é só aprovação', () => {
    const m = novo();
    m.registrarRascunho(ID, 'um', meta);
    expect(m.corrigir(ID, 'um', meta)).toMatchObject({ status: 'revisado', origem: 'humano' });
    expect(m.corrigir(ID, 'outro', meta)).toMatchObject({
      status: 'corrigido',
      pt: 'outro',
      seq: 3,
    });
  });
  it('rascunho nunca sobrescreve texto revisado ou corrigido', () => {
    const m = novo();
    m.registrarRascunho(ID, 'um', meta);
    m.aprovar(ID, meta);
    expect(() => m.registrarRascunho(ID, 'novo', meta)).toThrow(/já está revisado/);
  });
  it('não há como revisar o que não foi traduzido', () => {
    expect(() => novo().aprovar(ID, meta)).toThrow(/ainda não tem tradução/);
  });
  it('grava só o que é novo e relê o mesmo estado', () => {
    const m = novo();
    m.registrarRascunho(ID, 'um', meta);
    expect(m.gravar()).toBe(1);
    expect(m.gravar()).toBe(0);
    m.aprovar(ID, meta);
    expect(m.gravar()).toBe(1);
    const relido = new Memoria(m.caminho);
    expect(relido.estado(ID)).toMatchObject({ status: 'revisado', seq: 2 });
    expect(readFileSync(m.caminho, 'utf8').trim().split('\n')).toHaveLength(2);
  });
  it('recusa arquivo adulterado: IA com status revisado, sequência fora de ordem, JSON ruim', () => {
    const base = { id: ID, pt: 'x', glossario: 'g', data: '2026-11-16', nota: null, modelo: null };
    const caminho = (linhas: string[]) => {
      const c = join(mkdtempSync(join(tmpdir(), 'mem-')), 'm.jsonl');
      writeFileSync(c, linhas.join('\n') + '\n');
      return c;
    };
    const ev = (o: object) => JSON.stringify({ ...base, ...o });
    expect(() => new Memoria(caminho([ev({ seq: 1, status: 'revisado', origem: 'ia' })]))).toThrow(
      /IA não pode/,
    );
    expect(
      () => new Memoria(caminho([ev({ seq: 2, status: 'revisado', origem: 'humano' })])),
    ).toThrow(/fora de ordem/);
    expect(() => new Memoria(caminho(['{ruim']))).toThrow(/JSON inválido/);
  });
});
