# pipeline

Download versionado, leitura com validação, mapeamento de princípios ativos e geração da base SQLite.
Entra nas Fases 1 e 2. Ver [ADR 0002](../docs/adr/0002-fontes-de-dados.md).

| Pasta      | Estado                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `anvisa/`  | Pronto (P4): download, leitura, relatório de qualidade. Ver [`docs/fontes/anvisa.md`](../docs/fontes/anvisa.md).                            |
| `ddinter/` | Pronto (P5): importação ou download dos 8 CSVs, leitura, relatório de qualidade. Ver [`docs/fontes/ddinter.md`](../docs/fontes/ddinter.md). |

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

## DDInter

```bash
pnpm pipeline:ddinter:importar <pasta>                 # registra os 8 CSVs baixados à mão (aceita prefixo no nome)
pnpm pipeline:ddinter                                  # baixa (endereço padrão, não testado) e processa
pnpm pipeline:ddinter --pasta <pasta>                  # importa de uma pasta e processa
pnpm --filter @doctorine/pipeline-ddinter processar    # só o processamento do conjunto mais recente
```

O que acontece:

1. **Guarda** os 8 arquivos `ddinter_downloads_code_{A,B,D,H,L,P,R,V}.csv` em
   `data/raw/ddinter/<versão>/`, com `manifesto.json` (origem `download` ou `manual`, data, checksum de
   cada arquivo). A versão são os 12 primeiros caracteres do SHA-256 do conjunto; guardar o mesmo
   conteúdo de novo não muda nada, e conjunto incompleto não vira versão.
2. **Processa** para `data/processed/ddinter/<versão>/`:
   - `interacoes.jsonl`: um par de medicamentos por linha, sem direção, com o nível original do
     DDInter e `proveniencia` (fonte, versão, data e todas as linhas de origem);
   - `farmacos.jsonl`: medicamentos distintos (identificador e nome DDInter, arquivos, nº de pares);
   - `rejeicoes.jsonl` e `avisos.jsonl`: linhas rejeitadas com motivo, e decisões tomadas (nível
     conflitante entre arquivos, nome divergente);
   - `relatorio-qualidade.md` e `.json`: linhas lidas = pares distintos + repetidas + rejeitadas;
     números por arquivo, níveis, em quantos arquivos o par aparece, rejeições e avisos, suspeita de
     perda de caractere e a nota de cobertura.

Como na ANVISA, o resultado depende só dos bytes e da data do manifesto: rodar de novo gera arquivos
idênticos byte a byte. O checksum de cada arquivo e do conjunto é conferido antes da leitura.

### Exportações do site

```bash
pnpm pipeline:ddinter:site <pasta>                     # registra as 6 exportações e processa
pnpm --filter @doctorine/pipeline-ddinter processar-site
```

Guarda `severity_1/2/3.csv`, `drug_food.csv`, `drug_disease.csv` e `therapeutic_duplication.csv`
(com manifesto e checksum, como acima) em `data/raw/ddinter-site/<versão>/` e gera em
`data/processed/ddinter-site/<versão>/`: `textos-interacao.jsonl`, `alimentos.jsonl`, `doencas.jsonl`,
`duplicidade.jsonl`, `rejeicoes.jsonl`, `avisos.jsonl` e o relatório de qualidade. Detalhes e limites
em [`docs/fontes/ddinter.md`](../docs/fontes/ddinter.md).

`csv.ts` é cópia do leitor da ANVISA (com separador `,`); se um terceiro leitor aparecer, vale
extrair para um pacote comum.
