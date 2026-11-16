# Mapeamento de princípios ativos (P7)

Liga o texto de princípio ativo da ANVISA (português) aos medicamentos do DDInter (inglês) por meio
de um princípio ativo canônico. Decisões e motivos: [ADR 0006](adr/0006-mapeamento-de-principios-ativos.md).

## O que acontece na carga

```bash
pnpm pipeline:base        # gera a base e, ao lado, os arquivos de revisão
```

Para cada componente do texto da ANVISA ("atorvastatina cálcica, ezetimiba" tem dois):

| Status       | Quando                                                                                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| `confirmado` | Há uma decisão em `data/mapeamento/decisoes.json`. Vale mais que tudo.                                               |
| `automatico` | O nome, sem sal seguro, tem uma grafia em inglês **idêntica** ao nome de **um** medicamento do DDInter.              |
| `pendente`   | Qualquer outro caso. Não vira princípio ativo: o medicamento aparece como **não verificado**, nunca "sem interação". |

## O que a carga resolve sozinha, sem ninguém confirmar

- Nome igual no DDInter depois das regras de grafia, tirando só sais e hidratos seguros.
- Nome que a DCB (ANVISA) classifica só como excipiente, homeopático, planta medicinal ou
  radiofármaco e que o DDInter não tem. Esses viram princípio ativo **sem fármaco DDInter**: no
  motor, "sem dados na fonte". A lista está em `data/mapeamento/classes-dcb.json`; para refazê-la com
  uma DCB nova: `python3 -I data/mapeamento/gerar-classes-dcb.py <planilha.xlsx>` (precisa do
  openpyxl). O relatório de carga mostra quantos componentes entraram por classe.

Similaridade de grafia nunca aceita nada sozinha. O que sobra continua na fila e é decidido na
ferramenta de revisão (P9), não pela farmacêutica na carga.

## Decisões iniciais (2026-11-16)

`data/mapeamento/decisoes.json` começa com 236 decisões do topo da fila: 163 `equivale` com o nome
conferido contra a lista do DDInter, 3 `mesmo-que` e 70 `sem-equivalente`, só para substância
que o DDInter não tem (busca por nome). Fora ficaram vacinas, imunoglobulinas, fatores de coagulação,
misturas e qualquer caso duvidoso, que continuam na fila. Para os produtos de uso só local o `equivale`
lista também a entrada "(topical)" ou "(ophthalmic)" do DDInter. `sem-equivalente` quer dizer "sem
dados na fonte" (por exemplo bromazepam e domperidona), não "sem interação": o motor (P10) tem de
mostrar isso.

## Arquivos de revisão (em `data/processed/base/<versão>/`)

| Arquivo                         | Para quê                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `mapeamento-fila.csv` / `.json` | Os pendentes, do que afeta mais medicamentos ativos ao que afeta menos, com candidatos sugeridos |
| `mapeamento-automaticos.csv`    | Todos os automáticos, para a farmacêutica conferir por amostragem                                |
| `mapeamento-referencia.csv`     | Situação de cada nome do conjunto de referência dela                                             |
| `relatorio-carga.md`            | Cobertura (% de ativos completos), quanto a fila resolve, sais tirados                           |

Os CSV usam `;` e UTF-8 com BOM: abrem direto no Excel em português.

## Como decidir

### Pela planilha (o caminho normal)

1. Abra `mapeamento-fila.csv` no Excel (ou Planilhas). Cada linha é um componente pendente, do que
   afeta mais medicamentos ativos ao que afeta menos; os três primeiros candidatos vêm sugeridos
   (`1162 · Acetaminophen · 1 · sinônimo`: o id é o número antes do primeiro `·`).
2. Preencha **só** estas colunas, nas linhas que decidir (as outras ficam em branco e são ignoradas):
   - `acao`: `equivale`, `sem-equivalente` ou `mesmo-que`.
   - `ddinter_ids` (equivale): o número do medicamento, ou `c1`, `c2`, `c3` para "o candidato 1, 2
     ou 3 desta linha"; mais de um separado por `|`.
   - `como_chave` (mesmo-que): a `chave` de um componente que já foi resolvido.
   - `nome_pt` (opcional): o nome oficial em português. `observacao` (opcional): o motivo.
3. Salve como **CSV UTF-8** e importe:

```bash
pnpm pipeline:decisoes caminho/da/fila-preenchida.csv --revisor "Nome da farmacêutica" --simular   # só confere
pnpm pipeline:decisoes caminho/da/fila-preenchida.csv --revisor "Nome da farmacêutica"             # grava
pnpm pipeline:base                                                                                 # nova cobertura
```

Se houver qualquer erro (ação desconhecida, id mal escrito, chave já decidida...), o comando lista
as linhas com o problema e **não grava nada**. Dá para importar várias vezes: as decisões se acumulam.

### Direto no JSON (`data/mapeamento/decisoes.json`)

```json
{
  "versao": 1,
  "atualizadoEm": "2026-11-20",
  "decisoes": [
    {
      "chave": "paracetamol",
      "acao": "equivale",
      "ddinterIds": [123],
      "nomePt": "paracetamol",
      "revisadoPor": "Nome da farmacêutica",
      "revisadoEm": "2026-11-20"
    },
    {
      "chave": "ezetimiba",
      "acao": "sem-equivalente",
      "revisadoPor": "Nome da farmacêutica",
      "revisadoEm": "2026-11-20",
      "motivo": "não consta no DDInter"
    },
    {
      "chave": "acetaminofeno",
      "acao": "mesmo-que",
      "comoChave": "paracetamol",
      "revisadoPor": "Nome da farmacêutica",
      "revisadoEm": "2026-11-20"
    }
  ]
}
```

- `chave` é a coluna `chave` da fila: o texto da ANVISA **sem acento e em minúsculas**.
- `equivale`: `ddinterIds` são os números dos candidatos da fila (`1237 · Moexipril · 0.83` é o id
  1237). Pode ter mais de um id se o DDInter separa o que a ANVISA junta. `nomePt` é opcional (o
  nome oficial em português; sem ele, vale o texto da ANVISA sem sal).
- `sem-equivalente`: é um princípio ativo real, mas o DDInter não o tem. Daí em diante, "nenhuma
  ocorrência" para ele é um fato da fonte, não um erro de ligação.
- `mesmo-que`: outra grafia de um componente que já foi resolvido (o alvo não pode estar pendente).
- `revisadoPor` e `revisadoEm` são obrigatórios. Um id do DDInter que não existe derruba a carga.

Depois de editar, rode `pnpm pipeline:base` de novo: a versão da base muda e o relatório mostra a
nova cobertura.

## Critério de conclusão da Fase 2

```bash
pnpm pipeline:base --exigir-referencia
```

Termina com erro enquanto algum nome do conjunto de referência não estiver `confirmado`.

## Sugestões da fila

Os candidatos vêm de grafia parecida e de uma tabela curta de sinônimos (paracetamol =
acetaminophen, dipirona = metamizole...). Os de sinônimo aparecem marcados e **nunca** mapeiam
sozinhos: a farmacêutica confirma.

## Limites que valem a pena saber

- O automático **só perde** cobertura (manda para a fila); ele não liga por semelhança. Mesmo assim,
  confira uma amostra de `mapeamento-automaticos.csv`: um nome em inglês idêntico pode, raramente,
  ser outra substância.
- Sulfato, fosfato, acetato, citrato, cloreto, óxido, hidróxido e carbonato **não** são tirados
  sozinhos: em "sulfato de magnésio" o sal é o medicamento. Esses vão para a fila.
- Texto cortado pela ANVISA (380 caracteres): o último componente nunca é ligado.
- Concentração não é preenchida (a ANVISA não a informa nesse campo).
