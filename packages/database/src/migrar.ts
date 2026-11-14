import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PASTA_MIGRACOES = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');
const SEPARADOR = '--> statement-breakpoint';

export interface Migracao {
  /** Nome do arquivo sem extensão, por exemplo `0000_base`. */
  nome: string;
  sha256: string;
  comandos: string[];
}

/** Lê as migrações `NNNN_nome.sql` da pasta, em ordem. Não abre banco. */
export function lerMigracoes(pasta: string = PASTA_MIGRACOES): Migracao[] {
  return readdirSync(pasta)
    .filter((n) => /^\d{4}_.+\.sql$/.test(n))
    .sort()
    .map((arquivo) => {
      const texto = readFileSync(join(pasta, arquivo), 'utf8').replace(/\r\n/g, '\n');
      return {
        nome: arquivo.replace(/\.sql$/, ''),
        sha256: createHash('sha256').update(texto).digest('hex'),
        comandos: texto
          .split(SEPARADOR)
          .map((c) => c.trim())
          .filter((c) => c !== ''),
      };
    });
}

/**
 * Aplica as migrações que faltam, cada uma numa transação, e registra o checksum de cada uma em
 * `_migracoes`. Migração já aplicada e depois alterada derruba a execução: a base entregue
 * precisa vir de um esquema conhecido.
 */
export function migrar(
  db: DatabaseSync,
  migracoes: readonly Migracao[] = lerMigracoes(),
): string[] {
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(
    'CREATE TABLE IF NOT EXISTS _migracoes (nome TEXT PRIMARY KEY, sha256 TEXT NOT NULL) STRICT',
  );
  const feitas = new Map(
    (
      db.prepare('SELECT nome, sha256 FROM _migracoes').all() as Array<{
        nome: string;
        sha256: string;
      }>
    ).map((l) => [l.nome, l.sha256]),
  );
  const aplicadas: string[] = [];
  for (const m of migracoes) {
    const anterior = feitas.get(m.nome);
    if (anterior !== undefined) {
      if (anterior !== m.sha256) {
        throw new Error(
          `a migração ${m.nome} já foi aplicada e mudou depois; crie uma nova migração`,
        );
      }
      continue;
    }
    db.exec('BEGIN');
    try {
      for (const c of m.comandos) db.exec(c);
      db.prepare('INSERT INTO _migracoes (nome, sha256) VALUES (?, ?)').run(m.nome, m.sha256);
      db.exec('COMMIT');
    } catch (erro) {
      db.exec('ROLLBACK');
      throw erro;
    }
    aplicadas.push(m.nome);
  }
  return aplicadas;
}

/** Reconstrói os índices de busca (FTS5) a partir das tabelas de origem. Chamar no fim da carga. */
export function reconstruirBusca(db: DatabaseSync): void {
  for (const t of ['busca_medicamento', 'busca_ddinter_farmaco', 'busca_principio_ativo_nome']) {
    db.exec(`INSERT INTO ${t}(${t}) VALUES ('rebuild')`);
  }
}
