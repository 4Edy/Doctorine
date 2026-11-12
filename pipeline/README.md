# pipeline

Download versionado, leitura com validação, mapeamento de princípios ativos e geração da base SQLite.
Entra nas Fases 1 e 2. Ver [ADR 0002](../docs/adr/0002-fontes-de-dados.md).

| Pasta     | Estado                                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------------------------- |
| `anvisa/` | Pronto (P4): download, leitura, relatório de qualidade. Ver [`docs/fontes/anvisa.md`](../docs/fontes/anvisa.md). |
| DDInter   | P5.                                                                                                              |

## ANVISA

```bash
pnpm pipeline:anvisa                                   # baixa e processa (equivale a "tudo")
pnpm --filter @doctorine/pipeline-anvisa baixar        # só o download
pnpm --filter @doctorine/pipeline-anvisa processar     # só o processamento do download mais recente
```

O que acontece:

1. **Download** para `data/raw/anvisa/<versão>/`, onde a versão são os 12 primeiros caracteres do
   SHA-256 do arquivo. A pasta guarda o CSV e o `manifesto.json` (endereço, data, checksum, tamanho,
   cabeçalhos do servidor). Baixar o mesmo conteúdo de novo não muda nada.
2. **Processamento** para `data/processed/anvisa/<versão>/`:
   - `registros.jsonl`: um registro válido por linha, com `proveniencia` (fonte, versão, data do
     download, linha de origem);
   - `rejeicoes.jsonl`: linhas que não viraram registro (formato do CSV, número de colunas ou
     esquema), com o motivo e os campos originais;
   - `avisos.jsonl`: registros mantidos com um campo informativo (as datas) vazio por formato
     inesperado, com o valor original;
   - `relatorio-qualidade.md` e `.json`: linhas lidas = registros distintos + duplicadas exatas +
     rejeitadas; rejeições por motivo e coluna (com amostra de cada categoria); avisos; campos vazios;
     suspeita de perda de caractere; princípio ativo ausente ou cortado (todos e só ativos); o que muda
     entre registros de mesmo número; distribuições.

O processamento depende só dos bytes do arquivo e da data do manifesto (nunca do relógio): rodar de
novo, ou do zero em outra máquina, gera arquivos idênticos byte a byte. O checksum do manifesto é
conferido antes da leitura.

Os arquivos de `data/raw/` e `data/processed/` não são versionados.
