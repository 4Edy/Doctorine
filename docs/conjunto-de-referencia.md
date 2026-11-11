# Conjunto de referência

O conjunto de referência é uma lista de **30 a 50 pares** escolhidos pela farmacêutica, cada um com o
resultado esperado e a fonte que ela usou. Ele valida o pipeline (Fase 2) e o motor (Fase 4) e é a
principal defesa contra o maior risco do projeto: um falso negativo, isto é, o app não mostrar uma
interação que uma referência comercial mostra.

O arquivo é `data/reference-set/pairs.json`. Hoje está vazio de propósito: os pares clínicos vêm
dela, não de nós.

## Critério de conclusão da Fase 0

`pnpm validate:reference:strict` precisa passar:

- pelo menos 30 pares;
- todos revisados por ela (`revisao` preenchida);
- pelo menos um par **sem interação conhecida**, um **com alimento** e um **com doença**;
- nenhum par repetido (A com B equivale a B com A) e nenhuma contradição.

No dia a dia, `pnpm validate:reference` só confere o formato e roda a cada commit na integração
contínua.

## Formato

```json
{
  "versao": 1,
  "pares": [
    {
      "id": "exemplo-ficticio-1",
      "tipo": "medicamento-medicamento",
      "a": { "tipo": "principio_ativo", "nome": "Substância Fictícia A", "atc": "N02BE01" },
      "b": { "tipo": "principio_ativo", "nome": "Substância Fictícia B" },
      "esperado": { "ocorrencia": true, "gravidade": "moderada" },
      "fonte": {
        "nome": "Nome da referência que ela consultou",
        "referencia": "endereço ou citação",
        "consultadoEm": "2026-11-11"
      },
      "revisao": { "revisadoPor": "Nome", "revisadoEm": "2026-11-11" },
      "observacao": "opcional"
    }
  ]
}
```

O exemplo acima é fictício: não copie como dado clínico.

### Campos

| Campo                 | Regra                                                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                  | Único; minúsculas, números e hífens.                                                                                                                             |
| `tipo`                | `medicamento-medicamento`, `medicamento-alimento`, `medicamento-doenca`, `duplicidade` ou `sem-interacao`.                                                       |
| `a`                   | Sempre um princípio ativo (`tipo: "principio_ativo"`). `atc` é opcional.                                                                                         |
| `b`                   | Depende do `tipo`: princípio ativo (medicamento, duplicidade, sem interação), `alimento` ou `doenca`.                                                            |
| `esperado.ocorrencia` | `true` para todos os tipos, exceto `sem-interacao` (`false`).                                                                                                    |
| `esperado.gravidade`  | `contraindicada`, `grave`, `moderada` ou `leve`. Obrigatória nos tipos com medicamento, alimento e doença; opcional na duplicidade; proibida em `sem-interacao`. |
| `fonte`               | Nome, referência (endereço ou citação) e data da consulta.                                                                                                       |
| `revisao`             | `null` enquanto ela não revisou; depois, quem e quando.                                                                                                          |

Os nomes usam o **nome oficial em português** (DCB/ANVISA). A escala de gravidade (contraindicada, grave, moderada, leve) foi aprovada pelo Edu na Fase 0.

## Próximo passo sugerido

JSON não é o formato mais amigável para ela preencher. Se preferir, uma planilha (CSV) com um
conversor para este formato pode entrar num patch próximo.
