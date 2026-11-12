# Fonte: DDInter, interações medicamentosas

Registro das características da fonte, como o pipeline a lê e o que ainda não está confirmado.
Decisão de usar a fonte: [ADR 0002](../adr/0002-fontes-de-dados.md); licença e finalidade:
[ADR 0004](../adr/0004-finalidade-e-licencas.md).

## Arquivos usados

Oito arquivos CSV, um por letra, baixados à mão da página de download do DDInter em 2026-11-12 e
registrados com `pnpm pipeline:ddinter:importar <pasta>` (origem `manual` no manifesto):

| Arquivo                              | Linhas de dados | Pares distintos | Só neste arquivo |
| ------------------------------------ | --------------- | --------------- | ---------------- |
| `ddinter_downloads_code_A.csv`       | 56.367          | 56.367          | 30.224           |
| `ddinter_downloads_code_B.csv`       | 15.140          | 15.140          | 7.422            |
| `ddinter_downloads_code_D.csv`       | 25.681          | 25.681          | 6.616            |
| `ddinter_downloads_code_H.csv`       | 11.727          | 11.727          | 3.377            |
| `ddinter_downloads_code_L.csv`       | 65.389          | 65.389          | 47.974           |
| `ddinter_downloads_code_P.csv`       | 5.492           | 5.492           | 2.474            |
| `ddinter_downloads_code_R.csv`       | 30.563          | 30.563          | 13.717           |
| `ddinter_downloads_code_V.csv`       | 12.024          | 12.024          | 4.605            |
| **Conjunto** (versão `005d12e9a503`) | **222.383**     | **160.235**     |                  |

|             |                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| Codificação | UTF-8, sem BOM (só ASCII nestes arquivos), fim de linha CRLF; o leitor aceita BOM e LF                 |
| Separador   | `,`; texto entre aspas só quando o nome tem vírgula (por exemplo, `"Interferon alfa-2a, Recombinant"`) |
| Cabeçalho   | `DDInterID_A,Drug_A,DDInterID_B,Drug_B,Level` (igual nos 8; qualquer outro derruba o processamento)    |
| Versão      | SHA-256 do conjunto: lista `letra:sha256` dos 8 arquivos em ordem de letra; 12 primeiros caracteres    |

**Não confirmado:** a versão do DDInter (1.0 ou 2.0) a que estes arquivos correspondem. O formato é o
mesmo do DDInter 1.0 (o plugin público do biothings lê as mesmas colunas), e os arquivos não trazem
versão nem data. O endereço de download padrão do pipeline (`URL_BASE_PADRAO` em
`pipeline/ddinter/src/baixar.ts`) é um palpite baseado no do 1.0 e **nunca foi testado**: o site não
era acessível do ambiente de desenvolvimento. Se não funcionar, use `importar` ou `--base-url`.

## Colunas

| Coluna        | Como o pipeline trata                                                                    |
| ------------- | ---------------------------------------------------------------------------------------- |
| `DDInterID_A` | obrigatória, `DDInter<número>`                                                           |
| `Drug_A`      | obrigatória, sem espaço no começo ou no fim; mantida como veio (inglês, sem tradução)    |
| `DDInterID_B` | idem A; igual a A é rejeitado (medicamento interagindo consigo mesmo)                    |
| `Drug_B`      | idem A                                                                                   |
| `Level`       | obrigatória: `Major`, `Moderate`, `Minor` ou `Unknown`; qualquer outro valor é rejeitado |

Linha fora disso é **rejeitada com motivo** (`rejeicoes.jsonl`), nunca corrigida em silêncio. Os
arquivos exigidos são exatamente os 8; faltando ou sobrando um, o conjunto inteiro é recusado, porque
processar sem um deles reduziria a cobertura sem aviso.

## Como o par é tratado

- O par **não tem direção**: `(A, B)` e `(B, A)` são o mesmo. A saída põe o menor número de
  identificador primeiro.
- O mesmo par aparece em mais de um arquivo (62.148 linhas são repetição de um par já lido; 43.826
  pares estão em mais de um arquivo). Ele conta **uma vez** em `interacoes.jsonl`, com todas as
  origens (arquivo e linha) em `proveniencia.origens`.
- Se o mesmo par vier com níveis diferentes, fica o **mais grave** (`Major` > `Moderate` > `Minor` >
  `Unknown`), os níveis vistos ficam em `conflito` e a decisão vai para `avisos.jsonl`. Nos arquivos
  de 2026-11-12 isso nunca aconteceu.
- O nível é a classificação **original**. Converter para a escala do Doctorine (contraindicada, grave,
  moderada, leve, não determinada, nenhuma ocorrência) é trabalho da Fase 2; o DDInter não tem
  "contraindicada".

## Particularidades observadas

Do conjunto de 2026-11-12 (versão `005d12e9a503`):

- **Zero rejeições e zero avisos.** Nenhum identificador com dois nomes e nenhum nome com `?` ou
  caractere fora de ASCII. Todos os nomes estão em inglês.
- **1.939 medicamentos distintos** e **160.235 pares distintos**. Níveis: Moderate 96.675 (60,3%),
  Unknown 29.813 (18,6%), Major 26.914 (16,8%), Minor 6.833 (4,3%).
- **Os arquivos só têm a classificação.** Não há mecanismo, manejo, referências, interação com
  alimento, com doença nem duplicidade terapêutica. O plano das Fases 3 e 4 (cerca de 8,4 mil textos
  de mecanismo e manejo; alimento e doença) **não pode ser atendido só com estes arquivos**: é preciso
  achar de onde vêm esses dados (outra página de download do 2.0, raspagem das páginas de cada par,
  ou pedir ao DDInter). Isso é uma decisão em aberto para o Edu.
- **Cobertura incompleta, com falso negativo comprovado.** Pares como Sertralina + Tramadol,
  Sertralina + Fluoxetina e Digoxina + Furosemida **não estão** nos 8 arquivos, embora os
  medicamentos estejam (em outros pares). A hipótese (não confirmada) é que cada arquivo guarda só
  pares em que um dos dois medicamentos pertence à classe da letra (por exemplo, A = trato alimentar e
  metabolismo, B = sangue, L = antineoplásicos), e que pares entre medicamentos só de outras classes
  (cardiovascular, sistema nervoso, anti-infecciosos) ficam de fora. O artigo do DDInter 2.0 fala em
  cerca de 302 mil interações; aqui são 160 mil (valor do artigo a conferir). Consequência para o app:
  "nenhuma ocorrência nas fontes consultadas" tem peso menor do que parece, e o conjunto de referência
  da farmacêutica precisa incluir pares dessas classes.

## Licença e termos de uso

**Licença: CC BY-NC-SA 4.0** (Creative Commons Atribuição-NãoComercial-CompartilhaIgual 4.0
Internacional). Estado em 2026-11-12:

- A licença está registrada no repositório do plugin público do biothings
  (`manifest.json`: `"license": "CC BY-NC-SA 4.0"`, `license_url` do Creative Commons) e no README
  dele, que diz que os dados da página de download "são publicados sob" essa licença e remete à
  página de termos do DDInter. Ou seja, a confirmação vem de **fonte secundária**.
- **A página de termos do DDInter (`/terms/`) não foi lida por nós**: o site não era acessível do
  ambiente de desenvolvimento. Falta conferir o texto dela e registrar aqui qualquer condição
  adicional (por exemplo, forma de citar). Esta nota não é aconselhamento jurídico.
- Os arquivos baixados não trazem licença nem aviso dentro deles.

O que a licença exige, e como o projeto cumpre:

1. **Atribuição:** creditar o DDInter e indicar que houve mudanças. Texto proposto para a tela de
   créditos (Fase 6) e para o README: "Interações medicamentosas: DDInter (ddinter.scbdd.com), licença
   CC BY-NC-SA 4.0, conjunto versão `<versão>` baixado em `<data>`. Os dados foram reorganizados e
   traduzidos para o Doctorine." O artigo de referência é o do DDInter 2.0 (Nucleic Acids Research,
   2025; link no plano de fases).
2. **Uso não comercial:** coerente com a finalidade da ADR 0004 (estudo e uso pessoal, sem venda).
3. **Mesma licença nas derivadas:** a base derivada (`interacoes.jsonl`, o SQLite da Fase 2 e as
   traduções) fica sob CC BY-NC-SA 4.0. O código do pipeline não é obra derivada dos dados e segue a
   decisão da ADR 0004 (sem licença por ora).
4. **Dados não versionados:** `data/raw/` e `data/processed/` ficam fora do git, como na ANVISA; a
   inclusão da base derivada no repositório público continua em aberto na ADR 0004.

## Como reproduzir

```bash
pnpm pipeline:ddinter:importar <pasta com os 8 CSVs>   # registra arquivos baixados à mão
pnpm --filter @doctorine/pipeline-ddinter processar    # gera data/processed/ddinter/<versão>/
pnpm pipeline:ddinter --pasta <pasta>                  # os dois passos juntos
pnpm pipeline:ddinter                                  # tenta baixar do endereço padrão e processa
```

Detalhes e estrutura de pastas em [`pipeline/README.md`](../../pipeline/README.md).
