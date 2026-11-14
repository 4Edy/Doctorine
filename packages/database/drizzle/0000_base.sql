CREATE TABLE `ddinter_alimento` (
	`id` integer PRIMARY KEY NOT NULL,
	`farmaco_id` integer NOT NULL,
	`alimento_en` text NOT NULL,
	`nivel_original` text NOT NULL,
	`gravidade` text NOT NULL,
	`mecanismo_en` text,
	`interacao_en` text NOT NULL,
	`manejo_en` text NOT NULL,
	`referencias_json` text DEFAULT '[]' NOT NULL,
	`fonte_versao_id` integer NOT NULL,
	`arquivo` text NOT NULL,
	`linha` integer NOT NULL,
	FOREIGN KEY (`farmaco_id`) REFERENCES `ddinter_farmaco`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fonte_versao_id`) REFERENCES `fonte_versao`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ddinter_alimento_nivel" CHECK("ddinter_alimento"."nivel_original" in ('Major', 'Moderate', 'Minor', 'Unknown')),
	CONSTRAINT "ddinter_alimento_gravidade" CHECK("ddinter_alimento"."gravidade" in ('contraindicada', 'grave', 'moderada', 'leve', 'indeterminada'))
);
--> statement-breakpoint
CREATE INDEX `ddinter_alimento_farmaco` ON `ddinter_alimento` (`farmaco_id`);--> statement-breakpoint
CREATE INDEX `ddinter_alimento_alimento` ON `ddinter_alimento` (`alimento_en`);--> statement-breakpoint
CREATE TABLE `ddinter_alternativa` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id_par_site` integer NOT NULL,
	`id_texto` integer NOT NULL,
	`farmaco_id` integer NOT NULL,
	`parceiro_id` integer,
	`grupos_json` text NOT NULL,
	`completo_json` text NOT NULL,
	`fonte_versao_id` integer NOT NULL,
	FOREIGN KEY (`id_texto`) REFERENCES `ddinter_texto`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`farmaco_id`) REFERENCES `ddinter_farmaco`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parceiro_id`) REFERENCES `ddinter_farmaco`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fonte_versao_id`) REFERENCES `fonte_versao`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ddinter_alternativa_par` ON `ddinter_alternativa` (`id_par_site`);--> statement-breakpoint
CREATE INDEX `ddinter_alternativa_farmaco` ON `ddinter_alternativa` (`farmaco_id`);--> statement-breakpoint
CREATE TABLE `ddinter_doenca` (
	`id` integer PRIMARY KEY NOT NULL,
	`farmaco_id` integer NOT NULL,
	`doenca_en` text NOT NULL,
	`nivel_original` text NOT NULL,
	`gravidade` text NOT NULL,
	`texto_en` text NOT NULL,
	`referencias_json` text DEFAULT '[]' NOT NULL,
	`fonte_versao_id` integer NOT NULL,
	`arquivo` text NOT NULL,
	`linha` integer NOT NULL,
	FOREIGN KEY (`farmaco_id`) REFERENCES `ddinter_farmaco`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fonte_versao_id`) REFERENCES `fonte_versao`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ddinter_doenca_nivel" CHECK("ddinter_doenca"."nivel_original" in ('Major', 'Moderate', 'Minor', 'Unknown')),
	CONSTRAINT "ddinter_doenca_gravidade" CHECK("ddinter_doenca"."gravidade" in ('contraindicada', 'grave', 'moderada', 'leve', 'indeterminada'))
);
--> statement-breakpoint
CREATE INDEX `ddinter_doenca_farmaco` ON `ddinter_doenca` (`farmaco_id`);--> statement-breakpoint
CREATE INDEX `ddinter_doenca_doenca` ON `ddinter_doenca` (`doenca_en`);--> statement-breakpoint
CREATE TABLE `ddinter_duplicidade` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`produto` text NOT NULL,
	`composicao` text NOT NULL,
	`classe` text NOT NULL,
	`farmaco_id` integer NOT NULL,
	`aviso` text NOT NULL,
	`nota` text NOT NULL,
	`fonte_versao_id` integer NOT NULL,
	`arquivo` text NOT NULL,
	`linha` integer NOT NULL,
	FOREIGN KEY (`farmaco_id`) REFERENCES `ddinter_farmaco`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fonte_versao_id`) REFERENCES `fonte_versao`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ddinter_duplicidade_farmaco` ON `ddinter_duplicidade` (`farmaco_id`);--> statement-breakpoint
CREATE TABLE `ddinter_farmaco` (
	`id` integer PRIMARY KEY NOT NULL,
	`nome_en` text NOT NULL,
	`drugbank` text,
	`fonte_versao_id` integer NOT NULL,
	FOREIGN KEY (`fonte_versao_id`) REFERENCES `fonte_versao`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ddinter_farmaco_nome` ON `ddinter_farmaco` (`nome_en`);--> statement-breakpoint
CREATE INDEX `ddinter_farmaco_drugbank` ON `ddinter_farmaco` (`drugbank`);--> statement-breakpoint
CREATE TABLE `ddinter_interacao` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`farmaco_a_id` integer NOT NULL,
	`farmaco_b_id` integer NOT NULL,
	`id_par_site` integer,
	`id_texto` integer,
	`nivel_site` text,
	`nivel_csv` text,
	`csv_arquivos` text,
	`gravidade` text NOT NULL,
	`mecanismos_json` text DEFAULT '[]' NOT NULL,
	`fonte_par_versao_id` integer,
	`fonte_csv_versao_id` integer,
	FOREIGN KEY (`farmaco_a_id`) REFERENCES `ddinter_farmaco`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`farmaco_b_id`) REFERENCES `ddinter_farmaco`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`id_texto`) REFERENCES `ddinter_texto`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fonte_par_versao_id`) REFERENCES `fonte_versao`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fonte_csv_versao_id`) REFERENCES `fonte_versao`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ddinter_interacao_sem_direcao" CHECK("ddinter_interacao"."farmaco_a_id" < "ddinter_interacao"."farmaco_b_id"),
	CONSTRAINT "ddinter_interacao_gravidade" CHECK("ddinter_interacao"."gravidade" in ('contraindicada', 'grave', 'moderada', 'leve', 'indeterminada')),
	CONSTRAINT "ddinter_interacao_nivel_site" CHECK("ddinter_interacao"."nivel_site" is null or "ddinter_interacao"."nivel_site" in ('Major', 'Moderate', 'Minor', 'Unknown')),
	CONSTRAINT "ddinter_interacao_nivel_csv" CHECK("ddinter_interacao"."nivel_csv" is null or "ddinter_interacao"."nivel_csv" in ('Major', 'Moderate', 'Minor', 'Unknown')),
	CONSTRAINT "ddinter_interacao_tem_fonte" CHECK("ddinter_interacao"."nivel_site" is not null or "ddinter_interacao"."nivel_csv" is not null),
	CONSTRAINT "ddinter_interacao_site_com_texto" CHECK(("ddinter_interacao"."nivel_site" is null) = ("ddinter_interacao"."id_par_site" is null) and ("ddinter_interacao"."id_par_site" is null) = ("ddinter_interacao"."id_texto" is null))
);
--> statement-breakpoint
CREATE INDEX `ddinter_interacao_par` ON `ddinter_interacao` (`farmaco_a_id`,`farmaco_b_id`);--> statement-breakpoint
CREATE INDEX `ddinter_interacao_b` ON `ddinter_interacao` (`farmaco_b_id`);--> statement-breakpoint
CREATE INDEX `ddinter_interacao_texto` ON `ddinter_interacao` (`id_texto`);--> statement-breakpoint
CREATE INDEX `ddinter_interacao_par_site` ON `ddinter_interacao` (`id_par_site`);--> statement-breakpoint
CREATE UNIQUE INDEX `ddinter_interacao_par_texto_unico` ON `ddinter_interacao` (`id_par_site`,`id_texto`);--> statement-breakpoint
CREATE TABLE `ddinter_texto` (
	`id` integer PRIMARY KEY NOT NULL,
	`nivel_original` text NOT NULL,
	`descricao_en` text,
	`manejo_en` text,
	`mecanismos_json` text DEFAULT '[]' NOT NULL,
	`referencias_json` text DEFAULT '[]' NOT NULL,
	`id_par_manejo` integer,
	`fonte_texto_versao_id` integer NOT NULL,
	`arquivo_texto` text NOT NULL,
	`linha_texto` integer NOT NULL,
	`fonte_manejo_versao_id` integer,
	FOREIGN KEY (`fonte_texto_versao_id`) REFERENCES `fonte_versao`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fonte_manejo_versao_id`) REFERENCES `fonte_versao`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ddinter_texto_nivel" CHECK("ddinter_texto"."nivel_original" in ('Major', 'Moderate', 'Minor', 'Unknown'))
);
--> statement-breakpoint
CREATE TABLE `fonte_versao` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fonte` text NOT NULL,
	`versao` text NOT NULL,
	`sha256` text NOT NULL,
	`baixado_em` text NOT NULL,
	`origem` text,
	`url` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fonte_versao_unica` ON `fonte_versao` (`fonte`,`versao`);--> statement-breakpoint
CREATE TABLE `mapeamento` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`origem` text NOT NULL,
	`chave_origem` text NOT NULL,
	`principio_ativo_id` integer,
	`status` text NOT NULL,
	`motivo` text,
	FOREIGN KEY (`principio_ativo_id`) REFERENCES `principio_ativo`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "mapeamento_origem" CHECK("mapeamento"."origem" in ('ddinter-farmaco', 'anvisa-componente')),
	CONSTRAINT "mapeamento_status" CHECK("mapeamento"."status" in ('automatico', 'confirmado', 'pendente')),
	CONSTRAINT "mapeamento_pendente_sem_principio" CHECK(("mapeamento"."status" = 'pendente') = ("mapeamento"."principio_ativo_id" is null))
);
--> statement-breakpoint
CREATE INDEX `mapeamento_principio` ON `mapeamento` (`principio_ativo_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `mapeamento_unico` ON `mapeamento` (`origem`,`chave_origem`);--> statement-breakpoint
CREATE TABLE `medicamento` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`numero_registro` text,
	`nome_produto` text NOT NULL,
	`tipo_produto` text NOT NULL,
	`categoria_regulatoria` text,
	`classe_terapeutica` text,
	`empresa_cnpj` text,
	`empresa_nome` text,
	`numero_processo` text,
	`data_finalizacao_processo` text,
	`vencimento_registro` text,
	`situacao_registro` text NOT NULL,
	`ativo` integer NOT NULL,
	`principio_ativo_original` text,
	`linhas_origem` integer NOT NULL,
	`fonte_versao_id` integer NOT NULL,
	`linha` integer NOT NULL,
	FOREIGN KEY (`fonte_versao_id`) REFERENCES `fonte_versao`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "medicamento_ativo_booleano" CHECK("medicamento"."ativo" in (0, 1)),
	CONSTRAINT "medicamento_linhas_origem_positivas" CHECK("medicamento"."linhas_origem" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `medicamento_numero_registro_unico` ON `medicamento` (`numero_registro`);--> statement-breakpoint
CREATE INDEX `medicamento_nome` ON `medicamento` (`nome_produto`);--> statement-breakpoint
CREATE TABLE `medicamento_principio` (
	`medicamento_id` integer NOT NULL,
	`ordem` integer NOT NULL,
	`principio_ativo_id` integer NOT NULL,
	`concentracao` text,
	PRIMARY KEY(`medicamento_id`, `ordem`),
	FOREIGN KEY (`medicamento_id`) REFERENCES `medicamento`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`principio_ativo_id`) REFERENCES `principio_ativo`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "medicamento_principio_ordem" CHECK("medicamento_principio"."ordem" >= 1)
);
--> statement-breakpoint
CREATE INDEX `medicamento_principio_principio` ON `medicamento_principio` (`principio_ativo_id`);--> statement-breakpoint
CREATE TABLE `meta` (
	`chave` text PRIMARY KEY NOT NULL,
	`valor` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `principio_ativo` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`nome_pt` text NOT NULL,
	`nome_en` text,
	`atc` text,
	CONSTRAINT "principio_ativo_slug_formato" CHECK("principio_ativo"."slug" glob '[a-z0-9]*' and "principio_ativo"."slug" not glob '*[^a-z0-9-]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `principio_ativo_slug_unico` ON `principio_ativo` (`slug`);--> statement-breakpoint
CREATE TABLE `principio_ativo_nome` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`principio_ativo_id` integer NOT NULL,
	`idioma` text NOT NULL,
	`nome` text NOT NULL,
	`fonte` text NOT NULL,
	FOREIGN KEY (`principio_ativo_id`) REFERENCES `principio_ativo`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "principio_ativo_nome_idioma" CHECK("principio_ativo_nome"."idioma" in ('pt', 'en'))
);
--> statement-breakpoint
CREATE INDEX `principio_ativo_nome_busca` ON `principio_ativo_nome` (`nome`);--> statement-breakpoint
CREATE UNIQUE INDEX `principio_ativo_nome_unico` ON `principio_ativo_nome` (`principio_ativo_id`,`idioma`,`nome`);