# Tradução dos textos clínicos (P8)

Os textos do DDInter (descrição, mecanismo, manejo, alimento, doença) estão em inglês. Este módulo
os leva ao português **uma vez por texto distinto**, com um status visível de revisão, sem nunca
traduzir nome de fármaco. Decisões: [ADR 0007](adr/0007-traducao.md). Código: `pipeline/traducao`.

## O que entra

`extrair` lê as saídas processadas do P5 (`ddinter-site`, `ddinter-manejo`, mais os nomes de
`ddinter` e `ddinter-pares`) e junta em **unidades**: cada texto em inglês, com espaços
normalizados, vira uma unidade com `id` = 16 primeiros caracteres do SHA-256. Texto igual em lugares
diferentes (muito comum no manejo) é uma unidade só, com todos os `usos` guardados.

| Tipo                                            | Origem                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| `interacao`                                     | `textos-interacao` (ou a descrição da página, se a exportação não tem o texto) |
| `manejo`                                        | `textos-manejo`                                                                |
| `alimento-mecanismo` / `-interacao` / `-manejo` | `alimentos`                                                                    |
| `doenca`                                        | `doencas`                                                                      |

Fora do escopo por enquanto: referências (citações, ficam como vieram), nomes de alimentos e de
doenças (termos curtos, melhor tratados como vocabulário no P9) e a duplicidade terapêutica.

A **prioridade** da unidade é a do uso mais grave (Major, Moderate, Minor, Unknown). Rascunho e
revisão seguem essa ordem.

## Nomes de fármacos

Antes de traduzir, cada nome de fármaco conhecido (os 2,3 mil do DDInter, mais longo primeiro,
palavra inteira, sem diferenciar maiúsculas) vira um marcador `[[F1]]`, `[[F2]]`... A tradução tem
de devolver **os mesmos marcadores, na mesma quantidade**; senão é rejeitada. O nome em português
vem do mapeamento (P7), nunca da tradução: `mostrar <id>` restaura os nomes usando
`data/traducao/nomes-pt.json` (`{"DDInter123": "nome"}`, opcional) e, sem ele, mostra o nome como
estava no inglês. Ligar isso ao mapeamento do P7 dentro da base fica para o P9/P10.

A tradução é guardada **com os marcadores**.

## Glossário

`data/traducao/glossario.json` (versionado): 136 termos propostos (desfechos, farmacocinética,
classes, alimentos). Cada termo tem `en`, `pt`, formas aceitas em português e `status`
(`proposto` ou `aprovado`). Se o termo aparece no inglês e a tradução não usa nenhuma forma aceita,
o resultado é **aviso** (proposto) ou **erro** (aprovado). Todos começam `proposto`: aprovar o
glossário é decisão da farmacêutica e vai para a ferramenta do P9.

## Memória de tradução e status

`data/traducao/memoria.jsonl` guarda eventos que só crescem; o estado de um texto é o último evento
e os anteriores são o histórico de versões.

| Status         | Quem gera                       | Significa                               |
| -------------- | ------------------------------- | --------------------------------------- |
| `nao-revisado` | rascunho (IA ou lote importado) | tradução automática, sem revisão humana |
| `revisado`     | pessoa                          | aprovada como estava                    |
| `corrigido`    | pessoa                          | corrigida (texto diferente do anterior) |

Regras testadas: rascunho entra sempre como `nao-revisado`; `revisado` e `corrigido` só vêm de
pessoa; rascunho novo **nunca sobrescreve** texto revisado ou corrigido; texto sem tradução não
tem status (aparece como "sem tradução" e o app mostra o inglês com selo). Se o inglês muda na
fonte, o `id` muda: a tradução antiga fica órfã (o `status` avisa) e o texto novo volta à fila.

## Como usar

```bash
pnpm pipeline:traducao status                # situação por gravidade
pnpm pipeline:traducao extrair               # lista as unidades em data/processed/traducao/<versão>/
pnpm pipeline:traducao exportar --lote 20    # grava data/traducao/lotes/lote-0001.json (mais grave primeiro)
pnpm pipeline:traducao importar resposta.json --modelo chat   # valida e grava
pnpm pipeline:traducao rascunhar --limite 200                 # pela API (ANTHROPIC_API_KEY)
pnpm pipeline:traducao validar               # confere a memória inteira (sai com 1 se houver erro)
pnpm pipeline:traducao mostrar <id>          # texto, histórico e nomes restaurados
```

Dois caminhos para o rascunho, com a mesma validação:

1. **Lote por arquivo (sem custo de API):** `exportar` gera um JSON com as regras, os termos do
   glossário que aparecem e os itens (`i`, `id`, `en` já com marcadores). Quem traduz (por exemplo,
   um chat) devolve `[{"id": "...", "pt": "..."}]` ou `{"itens": [...]}` e `importar` liga **só pelo
   `id`**.
2. **API:** `rascunhar` manda lotes (padrão 20 textos) a uma API de modelo, grava cada lote ao
   terminar (pode interromper e retomar) e, em 429 ou 5xx, espera e tenta de novo (10, 20, 40 e 80 s)
   antes de parar sem insistir. Rode primeiro com `--limite 40` e confira a amostra.

### Sem plano pago

`rascunhar` aceita `--provedor anthropic` (padrão), `gemini` e qualquer API no formato
"chat/completions": `groq`, `cerebras`, `openrouter`, `github`, `mistral`, `openai` (ou `--url` para
outra). Fora da Anthropic, `--modelo` é obrigatório (os modelos gratuitos mudam de nome e de limite
com frequência; veja a lista no painel do provedor). A chave vem de `GEMINI_API_KEY` (Gemini),
`ANTHROPIC_API_KEY` (Anthropic) ou `LLM_API_KEY` (os demais), ou de outra variável por `--chave-env`.

```powershell
$env:GEMINI_API_KEY = "sua-chave"
pnpm pipeline:traducao rascunhar --provedor gemini --modelo <modelo> --limite 40 --pausa 13000
```

Planos gratuitos limitam pedidos por minuto e por dia: `--pausa` espaça os lotes e, ao bater o limite
do dia, a execução para com o progresso salvo; é só rodar de novo no dia seguinte. Pelo menos uma
fonte (OpenRouter, setembro de 2026) lista os limites gratuitos de Google AI Studio, Groq, Cerebras,
OpenRouter e GitHub Models, mas eles mudam: confira no painel de cada um. O texto enviado é público
(DDInter), então a política de uso de dados dos planos gratuitos não é um problema aqui.

**Qualidade:** a validação garante nomes de fármacos preservados e glossário, mas **não** garante a
correção clínica. Modelos gratuitos menores erram mais; teste com `--limite 40`, leia o resultado
(`mostrar <id>`) e use o modelo mais forte que o plano permitir. Em qualquer caso, tudo continua
`nao-revisado` até a revisão do P9. Também funciona colar os lotes de `exportar` em um chat gratuito
(use `--lote 40` para menos idas e vindas) e importar a resposta.

Tradução que falha na validação **não é gravada**; volta a ser pendente e aparece no resumo da
execução. Avisos (glossário proposto, proporção de tamanho) são gravados.

## Limites

- Nada disto foi executado contra os dados reais (o clone do repositório não tem `data/processed`):
  o número de unidades e a taxa de rejeição só saem do primeiro `extrair` e do primeiro lote.
- A detecção de nomes só reconhece nomes que existem nas listas do DDInter. Um fármaco citado por
  outro nome (sinônimo, classe) fica como texto comum, e é por isso que o glossário e a revisão
  existem.
- Nome muito comum em inglês (por exemplo, `Iron`, `Insulin`) também vira marcador: é inofensivo
  (volta como estava ou como o mapeamento diz), mas o rascunho vê `[[F1]]` no lugar da palavra.
- A tradução por IA é rascunho. Ela não vira dado clínico confiável antes da revisão: a meta do
  plano é revisar todas as interações graves antes de qualquer uso real (o `status` mostra esse
  número) e uma amostra de 50 textos com taxa de erro registrada.
