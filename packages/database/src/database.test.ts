import { DatabaseSync } from 'node:sqlite';
import { getTableName, is } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import * as esquema from './schema.js';
import { severity, severityOrder } from '@doctorine/design-tokens';
import {
  compararGravidade,
  GRAVIDADES,
  gravidadeDoNivel,
  gravidadeDosNiveis,
  gravidadeMaisGrave,
  NIVEIS_ORIGINAIS,
} from './gravidade.js';
import { lerMigracoes, migrar, reconstruirBusca } from './migrar.js';

const novoBanco = (): DatabaseSync => {
  const db = new DatabaseSync(':memory:');
  migrar(db);
  return db;
};
const tabelas = (db: DatabaseSync): string[] =>
  (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{
      name: string;
    }>
  ).map((t) => t.name);

describe('gravidade', () => {
  it('converte cada nível original e nunca produz "contraindicada"', () => {
    expect(NIVEIS_ORIGINAIS.map(gravidadeDoNivel)).toEqual([
      'grave',
      'moderada',
      'leve',
      'indeterminada',
    ]);
  });

  it('segue a ordem de exibição do design (da mais para a menos grave)', () => {
    expect(GRAVIDADES).toEqual(severityOrder.filter((s) => s !== 'nenhuma'));
    for (const g of GRAVIDADES) expect(severity[g]).toBeDefined();
  });

  it('escolhe a mais grave; "indeterminada" só vence sozinha', () => {
    expect(gravidadeMaisGrave(['leve', 'grave', 'moderada'])).toBe('grave');
    expect(gravidadeMaisGrave(['indeterminada', 'leve'])).toBe('leve');
    expect(gravidadeMaisGrave(['indeterminada'])).toBe('indeterminada');
    expect(gravidadeDosNiveis(['Unknown', 'Minor'])).toBe('leve');
    expect(gravidadeDosNiveis(['Moderate', 'Major'])).toBe('grave');
  });

  it('compara de forma antissimétrica', () => {
    for (const a of GRAVIDADES)
      for (const b of GRAVIDADES)
        expect(Math.sign(compararGravidade(a, b)) + Math.sign(compararGravidade(b, a))).toBe(0);
  });
});

describe('migrações', () => {
  it('criam todas as tabelas e são idempotentes', () => {
    const db = new DatabaseSync(':memory:');
    const primeira = migrar(db);
    expect(primeira).toEqual(lerMigracoes().map((m) => m.nome));
    expect(migrar(db)).toEqual([]);
    expect(tabelas(db)).toEqual(
      expect.arrayContaining([
        'medicamento',
        'principio_ativo',
        'mapeamento',
        'ddinter_interacao',
        'ddinter_texto',
        'busca_medicamento',
      ]),
    );
  });

  it('recusam uma migração já aplicada que mudou', () => {
    const db = new DatabaseSync(':memory:');
    const originais = lerMigracoes();
    migrar(db, originais);
    const alteradas = originais.map((m, i) => (i === 0 ? { ...m, sha256: 'outro' } : m));
    expect(() => migrar(db, alteradas)).toThrow(/já foi aplicada e mudou/);
  });

  it('desfazem a migração inteira se um comando falhar', () => {
    const db = new DatabaseSync(':memory:');
    const ruim = {
      nome: '0000_ruim',
      sha256: 'x',
      comandos: ['CREATE TABLE a (x)', 'COMANDO INVALIDO'],
    };
    expect(() => migrar(db, [ruim])).toThrow();
    expect(tabelas(db)).not.toContain('a');
  });

  it('o banco migrado tem exatamente as tabelas do esquema Drizzle (mais a busca e o controle)', () => {
    const doEsquema = Object.values(esquema)
      .filter((v) => is(v, SQLiteTable))
      .map((t) => getTableName(t as SQLiteTable));
    const noBanco = tabelas(novoBanco()).filter(
      (t) => !t.startsWith('busca_') && !t.startsWith('sqlite_') && t !== '_migracoes',
    );
    expect(noBanco.sort()).toEqual(doEsquema.sort());
  });
});

describe('restrições de integridade', () => {
  const fonte = (db: DatabaseSync): number =>
    Number(
      db
        .prepare(
          "INSERT INTO fonte_versao (fonte, versao, sha256, baixado_em) VALUES ('f', 'v', 's', '2026-11-14')",
        )
        .run().lastInsertRowid,
    );
  const farmaco = (db: DatabaseSync, id: number, f: number): void => {
    db.prepare('INSERT INTO ddinter_farmaco (id, nome_en, fonte_versao_id) VALUES (?, ?, ?)').run(
      id,
      `Drug ${id}`,
      f,
    );
  };
  const interacao = (
    db: DatabaseSync,
    a: number,
    b: number,
    extra: Record<string, unknown> = {},
  ) => {
    const campos = { nivel_csv: 'Major', gravidade: 'grave', ...extra };
    const cols = ['farmaco_a_id', 'farmaco_b_id', ...Object.keys(campos)];
    db.prepare(
      `INSERT INTO ddinter_interacao (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    ).run(a, b, ...(Object.values(campos) as Array<string | number | null>));
  };

  it('exigem chave estrangeira ligada', () => {
    const db = novoBanco();
    expect(() => interacao(db, 1, 2)).toThrow(/FOREIGN KEY/);
  });

  it('o par não tem direção: A precisa ser menor que B', () => {
    const db = novoBanco();
    const f = fonte(db);
    farmaco(db, 1, f);
    farmaco(db, 2, f);
    interacao(db, 1, 2);
    expect(() => interacao(db, 2, 1)).toThrow(/CHECK/);
    expect(() => interacao(db, 1, 1)).toThrow(/CHECK/);
  });

  it('a interação precisa de alguma fonte e gravidade válida', () => {
    const db = novoBanco();
    const f = fonte(db);
    farmaco(db, 1, f);
    farmaco(db, 2, f);
    expect(() => interacao(db, 1, 2, { nivel_csv: null })).toThrow(/CHECK/);
    expect(() => interacao(db, 1, 2, { gravidade: 'nenhuma' })).toThrow(/CHECK/);
    expect(() => interacao(db, 1, 2, { nivel_csv: 'Severe' })).toThrow(/CHECK/);
  });

  it('par do site precisa de id do par, texto e nível juntos', () => {
    const db = novoBanco();
    const f = fonte(db);
    farmaco(db, 1, f);
    farmaco(db, 2, f);
    expect(() => interacao(db, 1, 2, { nivel_site: 'Major', nivel_csv: null })).toThrow(/CHECK/);
  });

  it('mapeamento pendente nunca tem princípio ativo, e os demais sempre têm', () => {
    const db = novoBanco();
    db.prepare(
      "INSERT INTO principio_ativo (slug, nome_pt) VALUES ('losartana', 'losartana')",
    ).run();
    const inserir = (status: string, principio: number | null, chave: string) =>
      db
        .prepare(
          "INSERT INTO mapeamento (origem, chave_origem, principio_ativo_id, status) VALUES ('ddinter-farmaco', ?, ?, ?)",
        )
        .run(chave, principio, status);
    inserir('pendente', null, '1');
    inserir('confirmado', 1, '2');
    expect(() => inserir('pendente', 1, '3')).toThrow(/CHECK/);
    expect(() => inserir('automatico', null, '4')).toThrow(/CHECK/);
    expect(() => inserir('confirmado', 1, '2')).toThrow(/UNIQUE/);
  });

  it('o slug do princípio ativo é único e sem acento ou espaço', () => {
    const db = novoBanco();
    const inserir = (slug: string) =>
      db.prepare('INSERT INTO principio_ativo (slug, nome_pt) VALUES (?, ?)').run(slug, 'x');
    inserir('acido-acetilsalicilico');
    expect(() => inserir('acido-acetilsalicilico')).toThrow(/UNIQUE/);
    expect(() => inserir('ácido')).toThrow(/CHECK/);
    expect(() => inserir('com espaco')).toThrow(/CHECK/);
    expect(() => inserir('-comeca-com-hifen')).toThrow(/CHECK/);
  });

  it('um número de registro da ANVISA não se repete', () => {
    const db = novoBanco();
    const f = fonte(db);
    const inserir = (numero: string | null) =>
      db
        .prepare(
          `INSERT INTO medicamento (numero_registro, nome_produto, tipo_produto, situacao_registro, ativo, linhas_origem, fonte_versao_id, linha)
           VALUES (?, 'X', 'MEDICAMENTO', 'Ativo', 1, 1, ?, 2)`,
        )
        .run(numero, f);
    inserir('123');
    expect(() => inserir('123')).toThrow(/UNIQUE/);
    // registros sem número (baixo risco) podem ser vários
    inserir(null);
    inserir(null);
  });
  it('componentes pendentes nunca passam do total de componentes, e o truncado é 0 ou 1', () => {
    const db = novoBanco();
    const f = fonte(db);
    const inserir = (componentes: number, pendentes: number, truncado: number) =>
      db
        .prepare(
          `INSERT INTO medicamento (nome_produto, tipo_produto, situacao_registro, ativo, linhas_origem, componentes, componentes_pendentes, principio_truncado, fonte_versao_id, linha)
           VALUES ('X', 'MEDICAMENTO', 'Ativo', 1, 1, ?, ?, ?, ?, 2)`,
        )
        .run(componentes, pendentes, truncado, f);
    inserir(2, 1, 0);
    inserir(0, 0, 0);
    expect(() => inserir(1, 2, 0)).toThrow(/CHECK/);
    expect(() => inserir(-1, 0, 0)).toThrow(/CHECK/);
    expect(() => inserir(1, 0, 2)).toThrow(/CHECK/);
    // sem informar, o medicamento não tem componentes (ainda não passou pelo mapeamento)
    db.prepare(
      `INSERT INTO medicamento (nome_produto, tipo_produto, situacao_registro, ativo, linhas_origem, fonte_versao_id, linha)
       VALUES ('Y', 'MEDICAMENTO', 'Ativo', 1, 1, ?, 3)`,
    ).run(f);
    expect(
      db
        .prepare(
          "SELECT componentes, componentes_pendentes, principio_truncado FROM medicamento WHERE nome_produto = 'Y'",
        )
        .get(),
    ).toEqual({ componentes: 0, componentes_pendentes: 0, principio_truncado: 0 });
  });
});

describe('busca por nome (FTS5)', () => {
  it('acha sem acento e sem diferença de maiúsculas, depois de reconstruir o índice', () => {
    const db = novoBanco();
    const f = Number(
      db
        .prepare(
          "INSERT INTO fonte_versao (fonte, versao, sha256, baixado_em) VALUES ('f', 'v', 's', '2026-11-14')",
        )
        .run().lastInsertRowid,
    );
    for (const [n, nome] of [
      ['1', 'ÁGUA PARA INJEÇÃO'],
      ['2', 'TORVILIP'],
    ] as const) {
      db.prepare(
        `INSERT INTO medicamento (numero_registro, nome_produto, tipo_produto, situacao_registro, ativo, linhas_origem, fonte_versao_id, linha)
         VALUES (?, ?, 'MEDICAMENTO', 'Ativo', 1, 1, ?, 2)`,
      ).run(n, nome, f);
    }
    reconstruirBusca(db);
    const achar = (q: string) =>
      (
        db
          .prepare(
            'SELECT rowid FROM busca_medicamento WHERE busca_medicamento MATCH ? ORDER BY rowid',
          )
          .all(q) as Array<{ rowid: number }>
      ).map((r) => r.rowid);
    expect(achar('agua injecao')).toEqual([1]);
    expect(achar('torvil*')).toEqual([2]);
    expect(achar('inexistente')).toEqual([]);
  });
});
