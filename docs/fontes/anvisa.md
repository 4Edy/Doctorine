# Fonte: ANVISA, dados abertos de medicamentos

Registro das características da fonte, como o pipeline a lê e o que ainda não está confirmado.
Decisão de usar a fonte: [ADR 0002](../adr/0002-fontes-de-dados.md).

## Arquivo usado

|              |                                                                                     |
| ------------ | ----------------------------------------------------------------------------------- |
| Arquivo      | `DADOS_ABERTOS_MEDICAMENTOS.csv`                                                    |
| Endereço     | https://dados.anvisa.gov.br/dados/DADOS_ABERTOS_MEDICAMENTOS.csv                    |
| Tamanho      | cerca de 46 MB (46.062.137 bytes em 2026-11-11)                                     |
| Atualização  | a listagem da ANVISA mostrava modificação em 2026-11-11 (frequência não confirmada) |
| Codificação  | **Windows-1252** (não é UTF-8; sem BOM)                                             |
| Separador    | `;`, texto entre aspas `"`, números de registro sem aspas                           |
| Fim de linha | LF                                                                                  |

A listagem em https://dados.anvisa.gov.br/dados/ tem muitos outros arquivos de medicamentos
(preços, fila de análise, farmacovigilância, restrições, fabricantes de IFA). Nenhum entra na v1.
O dicionário de dados em PDF (`Documentacao_e_Dicionario_de_Dados_MEDICAMENTOS.pdf`) **não foi
lido** até agora: as colunas abaixo vêm do cabeçalho e de uma amostra de 10 KB. O PDF de "Registros
Válidos" citado no plano é de um formato antigo e a listagem não traz CSV correspondente.

## Colunas

| Coluna                       | Como o pipeline trata                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `TIPO_PRODUTO`               | obrigatória (só `MEDICAMENTO` na amostra)                                           |
| `NOME_PRODUTO`               | obrigatória; nome comercial ou denominação                                          |
| `DATA_FINALIZACAO_PROCESSO`  | `DD/MM/AAAA` → `AAAA-MM-DD`; vazia vira `null`                                      |
| `CATEGORIA_REGULATORIA`      | texto livre (Similar, Genérico, Novo, Biológico, BAIXO RISCO...); vazia vira `null` |
| `NUMERO_REGISTRO_PRODUTO`    | só dígitos, como texto; vazio nos produtos de baixo risco                           |
| `DATA_VENCIMENTO_REGISTRO`   | `MMAAAA` → `AAAA-MM`                                                                |
| `NUMERO_PROCESSO`            | só dígitos, como texto (tamanhos variam)                                            |
| `CLASSE_TERAPEUTICA`         | texto livre; vazia vira `null`                                                      |
| `EMPRESA_DETENTORA_REGISTRO` | `CNPJ - NOME` → `{ cnpj, nome }`; sem esse padrão, só o nome                        |
| `SITUACAO_REGISTRO`          | obrigatória (`Ativo`, `Inativo`)                                                    |
| `PRINCIPIO_ATIVO`            | texto original, **sem separar** (a separação é da Fase 2); vazio em muitos produtos |

Só `TIPO_PRODUTO`, `NOME_PRODUTO` e `SITUACAO_REGISTRO` são obrigatórias; as demais podem vir
vazias, e se vierem preenchidas precisam ter o formato acima. Linha fora disso é **rejeitada com
motivo** (`rejeicoes.jsonl`), nunca corrigida em silêncio. Cabeçalho diferente do esperado derruba o
processamento inteiro.

## Particularidades observadas na amostra (2026-11-11)

- Cerca de 1 em cada 5 registros não tem princípio ativo (produtos de baixo risco, antigos,
  homeopáticos). Isso limita a cobertura do motor e entra no relatório de cobertura da Fase 2.
- `PRINCIPIO_ATIVO` parece cortado em 380 caracteres (um registro de polivitamínico termina no meio
  de "iodet"). O relatório conta os valores desse tamanho; o texto não é alterado.
- Os princípios ativos vêm em minúsculas, separados por vírgula, e alguns nomes contêm vírgula ou
  "+" no texto (por exemplo, "cloreto de sódio + associações"). Não dá para separar só por vírgula
  sem o mapeamento da Fase 2.
- O mesmo `NUMERO_REGISTRO_PRODUTO` pode aparecer mais de uma vez? Ainda não se sabe; o relatório
  de qualidade conta e lista os casos, sem descartar nenhum.

## Licença e termos de uso

**A confirmar.** Ainda não foi lido o texto oficial de termos de uso dos dados abertos da ANVISA
(a página da listagem tem `Leia_me.txt`, `readme.txt` e o Plano de Dados Abertos 2023-2025). Até
isso ser verificado e registrado aqui, os dados brutos e os gerados **não são versionados** no
repositório (ver [`data/README.md`](../../data/README.md)). Pendência da Fase 1: colar aqui o termo
e o endereço de onde ele foi lido.

## Como reproduzir

```bash
pnpm pipeline:anvisa
```

Detalhes e estrutura de pastas em [`pipeline/README.md`](../../pipeline/README.md).
