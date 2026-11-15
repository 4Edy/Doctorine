# Modelo de dados

Base SQLite gerada pelo pipeline (`pnpm pipeline:base`) e embarcada no app (ADR 0003). O esquema
está em [`packages/database/src/schema.ts`](../packages/database/src/schema.ts); as migrações SQL,
em `packages/database/drizzle/`. Decisões e motivos: [ADR 0005](adr/0005-modelo-de-dados.md).

## Como gerar

```bash
pnpm pipeline:anvisa && pnpm pipeline:ddinter:importar <pasta> ...   # saídas das fontes (P4 e P5)
pnpm pipeline:base                                                   # gera a base
```

A carga lê a versão mais recente de cada saída em `data/processed/` (ou a pedida com `--anvisa`,
`--ddinter`, `--site`, `--pares`, `--manejo`) e escreve em `data/processed/base/<versão>/`:

- `doctorine.sqlite`: a base;
- `relatorio-carga.md` e `.json`: o que entrou, o que foi descartado e por quê, avisos e verificações.

Não é versionado no git (ADR 0004). A mesma entrada gera o mesmo arquivo, byte a byte.

## Tabelas

| Camada       | Tabela                                                                           | O que guarda                                                                                                                          |
| ------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Proveniência | `fonte_versao`                                                                   | Cada conjunto carregado: fonte, versão, checksum, data                                                                                |
|              | `meta`                                                                           | Versão da base, esquema, fontes, licença e atribuição                                                                                 |
| ANVISA       | `medicamento`                                                                    | Um por número de registro; texto original do princípio ativo e quantos componentes ficaram sem mapear                                 |
| DDInter      | `ddinter_farmaco`                                                                | Medicamento em inglês, com DrugBank quando há                                                                                         |
|              | `ddinter_texto`                                                                  | Descrição, manejo, mecanismos e referências de uma interação (valem para vários pares)                                                |
|              | `ddinter_interacao`                                                              | Par de medicamentos: união do site e dos CSVs, gravidade e níveis originais                                                           |
|              | `ddinter_alternativa`                                                            | Alternativas por par lido                                                                                                             |
|              | `ddinter_alimento`, `ddinter_doenca`, `ddinter_duplicidade`                      | Medicamento × alimento, × doença; duplicidade terapêutica                                                                             |
| Canônica     | `principio_ativo`, `principio_ativo_nome`, `mapeamento`, `medicamento_principio` | Princípio ativo único, nomes por idioma, status do mapeamento, ligações (P7, [ADR 0006](adr/0006-mapeamento-de-principios-ativos.md)) |
| Busca        | `busca_medicamento`, `busca_ddinter_farmaco`, `busca_principio_ativo_nome`       | FTS5 sem acento e sem diferença de maiúsculas                                                                                         |

## Regras que valem a pena saber

- **Gravidade:** `contraindicada`, `grave`, `moderada`, `leve`, `indeterminada`. Major → grave,
  Moderate → moderada, Minor → leve, Unknown → indeterminada. O DDInter não gera "contraindicada".
  "Nenhuma ocorrência" não é uma linha: é consulta sem resultado, e nunca significa "seguro".
- **Par sem direção:** `farmaco_a_id < farmaco_b_id` (garantido por restrição).
- **Par do site × par só dos CSVs:** `nivel_site` e `id_par_site` nulos = par só dos CSVs (sem texto,
  `Unknown`). Os dois níveis originais ficam em `nivel_site` e `nivel_csv`; `gravidade` é a mais grave.
- **Mais de uma linha por par de medicamentos** é normal (o site dá mais de um id a 7.330 pares).
- **Textos em inglês** (`*_en`). A tradução e o status de revisão entram no P8, em tabela própria.
- **Mapeamento pendente** nunca tem princípio ativo, por restrição: o item aparece como não
  verificado, nunca como "sem interação". Como o pendente não tem linha em `medicamento_principio`,
  o medicamento guarda `componentes` e `componentes_pendentes`: `componentes_pendentes > 0` quer
  dizer que há componente sem princípio ativo (o motor só pode dizer "não verificado" para ele).
  `principio_truncado = 1`: o texto da ANVISA tem o tamanho do corte e o último componente não é ligado.
- **Princípio ativo:** um por medicamento do DDInter ligado (com sal e sem sal, duas grafias, etc.),
  mais os "sem equivalente no DDInter" confirmados por decisão. `nome_pt` nunca vem de tradução.
  Ver [`docs/mapeamento.md`](mapeamento.md).
- **Referências** são listas JSON na ordem da fonte, com os defeitos de origem (acentos perdidos).

## Exemplo de consulta

Interações entre dois medicamentos do DDInter, da mais para a menos grave:

```sql
SELECT i.gravidade, i.nivel_site, i.nivel_csv, t.descricao_en, t.manejo_en
FROM ddinter_interacao i
LEFT JOIN ddinter_texto t ON t.id = i.id_texto
WHERE i.farmaco_a_id = :menor AND i.farmaco_b_id = :maior
ORDER BY CASE i.gravidade
  WHEN 'contraindicada' THEN 0 WHEN 'grave' THEN 1 WHEN 'moderada' THEN 2
  WHEN 'leve' THEN 3 ELSE 4 END;
```

## Migrações

```bash
pnpm --filter @doctorine/database gerar-migracao   # depois de mudar schema.ts
```

Mudou o esquema? Gere uma migração nova; uma migração já aplicada que seja alterada faz a carga
falhar. Tabelas virtuais (busca) são escritas à mão (`drizzle-kit generate --custom`).
