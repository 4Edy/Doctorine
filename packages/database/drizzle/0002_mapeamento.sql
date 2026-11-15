-- P7: o medicamento passa a dizer quantos componentes o texto de princípio ativo tem e quantos
-- ficaram sem princípio ativo (pendentes ou cortados pela ANVISA). O motor usa isso para mostrar
-- "não verificado" em vez de "nenhuma ocorrência". Escrita à mão (ADD COLUMN) porque o SQL que o
-- drizzle-kit gera para esta mudança recria a tabela e copia colunas que ainda não existem.
-- O snapshot em meta/0002_snapshot.json continua sendo o do esquema atual.
ALTER TABLE `medicamento` ADD `componentes` integer DEFAULT 0 NOT NULL CONSTRAINT `medicamento_componentes_positivos` CHECK (`componentes` >= 0);--> statement-breakpoint
ALTER TABLE `medicamento` ADD `componentes_pendentes` integer DEFAULT 0 NOT NULL CONSTRAINT `medicamento_componentes_pendentes_coerentes` CHECK (`componentes_pendentes` >= 0 AND `componentes_pendentes` <= `componentes`);--> statement-breakpoint
ALTER TABLE `medicamento` ADD `principio_truncado` integer DEFAULT 0 NOT NULL CONSTRAINT `medicamento_truncado_booleano` CHECK (`principio_truncado` in (0, 1));
