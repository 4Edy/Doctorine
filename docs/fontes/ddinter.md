# Fonte: DDInter, interações medicamentosas

Duas entradas, ambas do DDInter 2.0 e ambas baixadas à mão em 2026-11-12: os **8 CSVs de pares** (só a gravidade) e as **6 exportações do site** (textos, alimentos, doenças, duplicidade). Os dois conjuntos ainda não se ligam: falta dizer a qual par cada texto pertence (ver [Pendências](#pendências)).

Registro das características da fonte, como o pipeline a lê e o que ainda não está confirmado.
Decisão de usar a fonte: [ADR 0002](../adr/0002-fontes-de-dados.md); licença e finalidade:
[ADR 0004](../adr/0004-finalidade-e-licencas.md).

## Arquivos usados: pares (8 CSVs)

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

**Versão:** os arquivos vêm do site do DDInter 2.0 (`ddinter2.scbdd.com`, página de download) e
são idênticos aos de uma segunda baixada no mesmo dia (mesmos checksums). O formato é o mesmo do
DDInter 1.0 (o plugin público do biothings lê as mesmas colunas), e os arquivos não trazem versão nem
data. O endereço de download padrão do pipeline (`URL_BASE_PADRAO` em `pipeline/ddinter/src/baixar.ts`)
é um palpite baseado no do 1.0 e **nunca foi testado**: o site não era acessível do shell do ambiente
de desenvolvimento. Se não funcionar, use `importar` ou `--base-url`.

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
- **Estes 8 arquivos só têm a classificação** (`Level`). Mecanismo, texto, alimento, doença e
  duplicidade estão nas exportações do site (próxima seção), mas **sem ligação com o par**.
- **Cobertura incompleta, com falso negativo comprovado.** Pares como Sertralina + Tramadol,
  Sertralina + Fluoxetina e Digoxina + Furosemida **não estão** nos 8 arquivos, embora os
  medicamentos estejam (em outros pares). A hipótese (não confirmada) é que cada arquivo guarda só
  pares em que um dos dois medicamentos pertence à classe da letra (por exemplo, A = trato alimentar e
  metabolismo, B = sangue, L = antineoplásicos), e que pares entre medicamentos só de outras classes
  (cardiovascular, sistema nervoso, anti-infecciosos) ficam de fora. O artigo do DDInter 2.0 fala em
  cerca de 302 mil interações; aqui são 160 mil (valor do artigo a conferir). Os arquivos de alimento,
  doença e duplicidade citam 46, 111 e 36 medicamentos que **não aparecem em nenhum par** destes 8
  arquivos (por exemplo `DDInter1981`), o que reforça que a lista de pares está incompleta. Consequência para o app:
  "nenhuma ocorrência nas fontes consultadas" tem peso menor do que parece, e o conjunto de referência
  da farmacêutica precisa incluir pares dessas classes.

## Exportações do site (6 CSVs)

Arquivos baixados à mão da interface do DDInter 2.0, registrados com
`pnpm pipeline:ddinter:site <pasta>` (origem `manual`; versão `61a7e6548592`; processamento em
`data/processed/ddinter-site/<versão>/`). Todos em UTF-8 com BOM; o leitor aceita com ou sem.

| Arquivo                       | Linhas | Registros | Conteúdo                                                              |
| ----------------------------- | ------ | --------- | --------------------------------------------------------------------- |
| `severity_1.csv`              | 2.398  | 2.398     | textos de interação **Major** (código 3), com mecanismos              |
| `severity_2.csv`              | 4.974  | 4.974     | textos **Moderate** (código 2)                                        |
| `severity_3.csv`              | 1.093  | 1.093     | textos **Minor** (código 1)                                           |
| `drug_food.csv`               | 857    | 857       | medicamento × alimento: gravidade, interação, **manejo**, referências |
| `drug_disease.csv`            | 8.359  | 8.359     | medicamento × doença: gravidade, texto, referências                   |
| `therapeutic_duplication.csv` | 6.033  | 6.033     | produto combinado × medicamento isolado, por classe, com aviso e nota |

Zero rejeições e 9 avisos (ver o relatório). Os níveis usam o mesmo código do site nos três
arquivos de gravidade (3 = Major, 2 = Moderate, 1 = Minor); a conversão foi conferida num exemplo
(texto id 9 é Major na página do par) e vale por convenção para alimento e doença, **sem
confirmação direta**.

O que o pipeline faz com cada arquivo:

- **`severity_*`** → `textos-interacao.jsonl`: id do texto, nível, texto, mecanismos marcados
  (Absorption, Antagonism, Distribution, Excretion, Metabolism, Others, Synergy). O arquivo diz o nível;
  se `level` ou `severity_filter` não combinar com o nome do arquivo, a linha é rejeitada. Id repetido
  em outro arquivo é rejeitado. 8.465 textos (7.900 distintos), ids de 0 a 8576, **112 ids ausentes**.
- **`drug_food`** → `alimentos.jsonl`. A coluna `magnesium` do arquivo é o **mecanismo** (nome errado
  na origem); o pipeline a chama de `mecanismo`. 29 alimentos, 726 medicamentos.
- **`drug_disease`** → `doencas.jsonl`. 472 doenças, 1.487 medicamentos.
- **`therapeutic_duplication`** → `duplicidade.jsonl`. 317 produtos combinados, 96 classes.
- Espaço no começo ou no fim de um campo (6 casos, em texto de alimento e em nome de medicamento) é
  removido e a linha vai para `avisos.jsonl`; perder o registro por isso seria pior.
- Referências vêm com `?` ou `�` no lugar de acentos (362 registros): perda de caractere **da
  origem**, não corrigida. Os textos clínicos estão limpos.

Particularidades:

- **Mais de um registro para o mesmo medicamento e doença é normal** (226 chaves, 238 linhas extras,
  39 com níveis diferentes): cada registro tem id e texto próprios (por exemplo, um texto sobre
  anticonvulsivantes e outro sobre benzodiazepínicos para o mesmo medicamento e doença). Em alimento
  há 1 caso (hidrocodona + álcool, níveis 2 e 3). O motor da Fase 4 precisa decidir como mostrar; o
  pipeline mantém todos.
- **Interações entre medicamentos não têm campo de manejo nestes arquivos.** Alimento tem
  (`newManagement`) e doença traz um texto único.
- **A duplicidade terapêutica só cobre produtos combinados** (marca contra medicamento isolado). Não
  há tabela de classe por medicamento, então duplicidade entre dois medicamentos isolados não sai daqui.

### Pendências

- **Ligar texto ao par.** Nos 8 CSVs o par não tem id de texto; nas exportações o texto não tem
  medicamentos. O site tem a ligação: a página de um texto (`/server/inter-detail/<id texto>/`) carrega
  a lista de pares por `POST /server/inter-list/<id texto>/` (resposta DataTables com `id` do par,
  identificadores DDInter e DrugBank dos dois medicamentos, nomes, nível e mecanismos). Para o texto 9
  devolve 1 par: Moexipril (`DDInter1237`, `DB00691`) + Sacubitril (`DDInter1630`, `DB09292`), par `110952`.
  Seriam cerca de 8,5 mil requisições (uma por texto, mais as páginas dos textos que valem para muitos
  pares), e a lista traria **pares que os 8 CSVs não têm**. A requisição exige token CSRF e cookie de
  sessão. **Não foi implementado nem executado**: depende de decisão do Edu (volume de requisições a um
  site de terceiros) e de resposta do grupo do DDInter.
- **Manejo dos pares:** a página de um par (`/server/interact/<id do par>/`, HTML no servidor) mostra
  manejo, alternativas por classe e referências. Isso não está em nenhuma exportação. Não se sabe se o
  manejo é por texto ou por par; se for por par, são centenas de milhares de páginas.
- **Identificadores externos** (DrugBank, ChEMBL, PubChem) de cada medicamento: úteis ao P7; vêm da
  lista de pares acima (DrugBank) ou da página de cada medicamento.

## Licença e termos de uso

**Licença: CC BY-NC-SA 4.0** (Creative Commons Atribuição-NãoComercial-CompartilhaIgual 4.0
Internacional). Estado em 2026-11-12:

- **Página de termos lida** (`https://ddinter2.scbdd.com/terms/`, leitura em 2026-11-12): ela
  informa que os dados do DDInter são disponibilizados sob a CC BY-NC-SA 4.0 e permite imprimir ou
  baixar o conteúdo "para uso pessoal, não comercial, informativo ou acadêmico". Raspagem e download
  em massa não são mencionados (nem permitidos nem proibidos). Não há formato de citação obrigatório.
  A página também avisa que a base é incompleta e pode ter erros e que a ausência de uma interação
  não significa que ela não exista. O rodapé do site traz "All Rights Reserved" do Computational Biology
  & Drug Design Group. A leitura foi feita por uma ferramenta de resumo de páginas, não pelo texto
  integral; vale uma conferência visual antes de publicar o repositório.
- A licença também consta no plugin público do biothings (`manifest.json`:
  `"license": "CC BY-NC-SA 4.0"`).
- Os arquivos baixados não trazem licença nem aviso dentro deles. Esta nota não é aconselhamento
  jurídico.

O que a licença exige, e como o projeto cumpre:

1. **Atribuição:** creditar o DDInter e indicar que houve mudanças. Texto proposto para a tela de
   créditos (Fase 6) e para o README: "Interações medicamentosas: DDInter 2.0 (ddinter2.scbdd.com),
   licença CC BY-NC-SA 4.0, conjuntos versão `<versão>` baixados em `<data>`. Os dados foram
   reorganizados e traduzidos para o Doctorine." O artigo de referência é o do DDInter 2.0 (Nucleic
   Acids Research, 2025; link no plano de fases).
2. **Uso não comercial:** coerente com a finalidade da ADR 0004 (estudo e uso pessoal, sem venda).
3. **Mesma licença nas derivadas:** a base derivada (`interacoes.jsonl`, os `.jsonl` das exportações,
   o SQLite da Fase 2 e as traduções) fica sob CC BY-NC-SA 4.0. O código do pipeline não é obra
   derivada dos dados e segue a decisão da ADR 0004 (sem licença por ora).
4. **Dados não versionados:** `data/raw/` e `data/processed/` ficam fora do git, como na ANVISA; a
   inclusão da base derivada no repositório público continua em aberto na ADR 0004.
5. **Raspagem:** como os termos não tratam do assunto e o site é de um grupo de pesquisa, qualquer
   coleta em volume deve ter limite de velocidade, identificação e, de preferência, aviso ao grupo.

## Como reproduzir

```bash
pnpm pipeline:ddinter:importar <pasta com os 8 CSVs>   # registra arquivos baixados à mão
pnpm --filter @doctorine/pipeline-ddinter processar    # gera data/processed/ddinter/<versão>/
pnpm pipeline:ddinter --pasta <pasta>                  # os dois passos juntos
pnpm pipeline:ddinter                                  # tenta baixar do endereço padrão e processa

# exportações do site (severity_*.csv, drug_food.csv, drug_disease.csv, therapeutic_duplication.csv)
pnpm pipeline:ddinter:site <pasta com os 6 CSVs>       # registra e processa
pnpm --filter @doctorine/pipeline-ddinter processar-site
```

Detalhes e estrutura de pastas em [`pipeline/README.md`](../../pipeline/README.md).
