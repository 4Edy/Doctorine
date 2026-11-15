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

## Arquivos de revisão (em `data/processed/base/<versão>/`)

| Arquivo                         | Para quê                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `mapeamento-fila.csv` / `.json` | Os pendentes, do que afeta mais medicamentos ativos ao que afeta menos, com candidatos sugeridos |
| `mapeamento-automaticos.csv`    | Todos os automáticos, para a farmacêutica conferir por amostragem                                |
| `mapeamento-referencia.csv`     | Situação de cada nome do conjunto de referência dela                                             |
| `relatorio-carga.md`            | Cobertura (% de ativos completos), quanto a fila resolve, sais tirados                           |

Os CSV usam `;` e UTF-8 com BOM: abrem direto no Excel em português.

## Como decidir (`data/mapeamento/decisoes.json`)

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

## Limites que valem a pena saber

- O automático **só perde** cobertura (manda para a fila); ele não liga por semelhança. Mesmo assim,
  confira uma amostra de `mapeamento-automaticos.csv`: um nome em inglês idêntico pode, raramente,
  ser outra substância.
- Sulfato, fosfato, acetato, citrato, cloreto, óxido, hidróxido e carbonato **não** são tirados
  sozinhos: em "sulfato de magnésio" o sal é o medicamento. Esses vão para a fila.
- Texto cortado pela ANVISA (380 caracteres): o último componente nunca é ligado.
- Concentração não é preenchida (a ANVISA não a informa nesse campo).
