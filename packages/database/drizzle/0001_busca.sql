-- Busca por nome (FTS5), sem acento e sem diferença de maiúsculas (ADR 0001).
-- Tabelas de conteúdo externo: o texto continua nas tabelas de origem e o índice é reconstruído
-- uma vez, no fim da carga, com `INSERT INTO <tabela>(<tabela>) VALUES ('rebuild')`. A base é
-- gerada pelo pipeline e entregue somente para leitura, por isso não há gatilhos.
CREATE VIRTUAL TABLE `busca_medicamento` USING fts5(
	`nome_produto`,
	content='medicamento',
	content_rowid='id',
	tokenize='unicode61 remove_diacritics 2'
);--> statement-breakpoint
CREATE VIRTUAL TABLE `busca_ddinter_farmaco` USING fts5(
	`nome_en`,
	content='ddinter_farmaco',
	content_rowid='id',
	tokenize='unicode61 remove_diacritics 2'
);--> statement-breakpoint
CREATE VIRTUAL TABLE `busca_principio_ativo_nome` USING fts5(
	`nome`,
	content='principio_ativo_nome',
	content_rowid='id',
	tokenize='unicode61 remove_diacritics 2'
);
