# Fonte: ANVISA, dados abertos de medicamentos

Registro das características da fonte, como o pipeline a lê e o que ainda não está confirmado.
Decisão de usar a fonte: [ADR 0002](../adr/0002-fontes-de-dados.md).

## Arquivo usado

|              |                                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| Arquivo      | `DADOS_ABERTOS_MEDICAMENTOS.csv`                                                                           |
| Endereço     | https://dados.anvisa.gov.br/dados/DADOS_ABERTOS_MEDICAMENTOS.csv                                           |
| Tamanho      | cerca de 46 MB (46.062.137 bytes em 2026-11-11)                                                            |
| Atualização  | pelo menos diária: o arquivo mudou entre 2026-11-11 e 2026-11-12 (versões `f512f01dbc7b` e `31d049cadc24`) |
| Codificação  | **Windows-1252** (não é UTF-8; sem BOM)                                                                    |
| Separador    | `;`, texto entre aspas `"`, números de registro sem aspas                                                  |
| Fim de linha | LF                                                                                                         |

A listagem em https://dados.anvisa.gov.br/dados/ tem muitos outros arquivos de medicamentos
(preços, fila de análise, farmacovigilância, restrições, fabricantes de IFA). Nenhum entra na v1.
O dicionário de dados em PDF (`Documentacao_e_Dicionario_de_Dados_MEDICAMENTOS.pdf`) **não foi
lido** até agora: as colunas abaixo vêm do cabeçalho e de uma amostra de 10 KB. O PDF de "Registros
Válidos" citado no plano é de um formato antigo e a listagem não traz CSV correspondente.

## Colunas

| Coluna                       | Como o pipeline trata                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| `TIPO_PRODUTO`               | obrigatória (só `MEDICAMENTO` na amostra)                                                |
| `NOME_PRODUTO`               | obrigatória; nome comercial ou denominação                                               |
| `DATA_FINALIZACAO_PROCESSO`  | `DD/MM/AAAA` → `AAAA-MM-DD`; vazia vira `null`; formato inesperado vira `null` com aviso |
| `CATEGORIA_REGULATORIA`      | texto livre (Similar, Genérico, Novo, Biológico, BAIXO RISCO...); vazia vira `null`      |
| `NUMERO_REGISTRO_PRODUTO`    | só dígitos, como texto; vazio nos produtos de baixo risco                                |
| `DATA_VENCIMENTO_REGISTRO`   | `MMAAAA` ou `MM/AAAA` → `AAAA-MM`; vazio vira `null`; ilegível vira `null` com aviso     |
| `NUMERO_PROCESSO`            | só dígitos, como texto (tamanhos variam)                                                 |
| `CLASSE_TERAPEUTICA`         | texto livre; vazia vira `null`                                                           |
| `EMPRESA_DETENTORA_REGISTRO` | `CNPJ - NOME` → `{ cnpj, nome }`; sem esse padrão, só o nome                             |
| `SITUACAO_REGISTRO`          | obrigatória (`Ativo`, `Inativo`)                                                         |
| `PRINCIPIO_ATIVO`            | texto original, **sem separar** (a separação é da Fase 2); vazio em muitos produtos      |

Só `TIPO_PRODUTO`, `NOME_PRODUTO` e `SITUACAO_REGISTRO` são obrigatórias; as demais podem vir
vazias, e se vierem preenchidas precisam ter o formato acima. Linha fora disso é **rejeitada com
motivo** (`rejeicoes.jsonl`), nunca corrigida em silêncio. As duas datas são informativas: com formato
inesperado, o registro é **mantido** com o campo vazio e o valor original vai para `avisos.jsonl`
(o motor não depende delas, e perder o medicamento por causa de uma data seria pior). Cópia exata de
outra linha é colapsada e contada à parte, não é erro. Cabeçalho diferente do esperado derruba o
processamento inteiro.

## Particularidades observadas

Do arquivo completo baixado em 2026-11-12 (versão `31d049cadc24`, 229.609 linhas de dados):

- **81% das linhas são cópias exatas de outra.** Só 42.741 registros são distintos (28.218 inativos e
  14.523 ativos). O arquivo provavelmente tem uma linha por apresentação ou por outro detalhe que
  não vem nas 11 colunas. As cópias são colapsadas e contadas.
- **O mesmo número de registro aparece em 2 registros distintos em 2.404 casos, e em todos eles a
  única diferença é a situação: uma linha `Ativo` e outra `Inativo`.** Ou seja, `SITUACAO_REGISTRO`
  não é uma propriedade do registro; a hipótese é que seja de cada apresentação ou etapa do registro
  (a confirmar no dicionário de dados e com a farmacêutica). Consequência para a Fase 2 e para o
  modelo de dados: não usar a linha como unidade; agrupar por número de registro e decidir a regra de
  situação (proposta: ativo se alguma linha for `Ativo`). Os dois registros são mantidos no
  resultado do P4.
- **Um em cada quatro registros não tem princípio ativo** (25,4%; 10.860). Entre os ativos são 4.089
  de 14.523 (28,2%), mas esse número engana sozinho: produtos de baixo risco não costumam ter
  princípio ativo. O relatório abre os ativos por categoria regulatória; o número que importa é o das
  categorias de medicamento (Similar, Genérico, Novo, Biológico...).
- **`PRINCIPIO_ATIVO` é cortado em 380 caracteres** (81 registros, 20 deles ativos). Isso faz o último
  princípio ativo sumir da lista e gera falso negativo; a Fase 2 precisa marcar esses registros como
  "composição incompleta", nunca em silêncio.
- **Os princípios ativos não perderam acentos:** nenhum valor de `PRINCIPIO_ATIVO` nem de
  `CLASSE_TERAPEUTICA` tem `?`. A perda aparece só em `NOME_PRODUTO` (426 registros com `?`, que pode
  ser acento perdido ou `?` legítimo; o relatório lista exemplos) e em `CATEGORIA_REGULATORIA` (47).
- **`DATA_VENCIMENTO_REGISTRO` vem em mais de um formato:** `MMAAAA` (padrão), `MM/AAAA` (por exemplo
  `12/2020`) e valores que não dá para interpretar (`09200`, `10200`, `1001`, `000000`). Os dois
  primeiros são lidos; os últimos viram aviso (10 registros na execução de 2026-11-12). Na primeira
  execução (2026-11-11), 75 linhas foram rejeitadas por isso, antes de a regra virar aviso.
- **`CATEGORIA_REGULATORIA` tem defeitos de origem:** valores cortados em 12 caracteres (`Gases Medici`,
  `Produto de T`), acento perdido (`FITOTER?PICO`, com `?` no arquivo) e a mesma categoria em caixas
  diferentes (`DINAMIZADO` e `Dinamizado`). Não normalizamos agora.
- Os princípios ativos vêm em minúsculas, separados por vírgula, e alguns nomes contêm vírgula ou
  "+" no texto (por exemplo, "cloreto de sódio + associações"). Não dá para separar só por vírgula
  sem o mapeamento da Fase 2.

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
