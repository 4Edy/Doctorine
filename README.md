# Doctorine

App mobile, offline, de apoio à análise farmacológica: dada uma lista de medicamentos, mostra
interações (entre medicamentos, com alimentos e com doenças) e duplicidade terapêutica, sempre com
fonte, versão da base e selo de tradução. Projeto de estudo e uso pessoal, feito para uso
profissional de uma farmacêutica.

> **Aviso.** Ferramenta de apoio, não substitui a avaliação de um profissional de saúde. "Nenhuma
> ocorrência nas fontes consultadas" **não** significa que a combinação é segura. Leia
> [`docs/AVISO.md`](docs/AVISO.md).

## Estado

Fase 0 (Fundação) em andamento, com a Fase 1 começando: o pipeline já baixa, lê e valida os dados
abertos de medicamentos da ANVISA (`pnpm pipeline:anvisa`) e lê os arquivos de interações do DDInter
(`pnpm pipeline:ddinter`), com relatório de qualidade para cada fonte. Ainda
não há código do motor nem do app.

## Estrutura

| Pasta                    | Conteúdo                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `app/`                   | App mobile (Expo + TypeScript). Fase 5.                                                                     |
| `pipeline/`              | Download, leitura e carga das fontes (ANVISA, DDInter). Fases 1 e 2.                                        |
| `packages/reference-set` | Esquema e validador do conjunto de referência da farmacêutica.                                              |
| `data/`                  | Dados versionados. Hoje, só `reference-set/pairs.json`.                                                     |
| `docs/`                  | Aviso de uso, guia do conjunto de referência, [fontes](docs/fontes/anvisa.md) e [ADRs](docs/adr/README.md). |

## Começando

Requisitos: Node 22 (`.nvmrc`) e pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm run ci                      # formatação, tipos, testes e validação do conjunto de referência
pnpm validate:reference:strict   # critério de conclusão da Fase 0 (falha enquanto o conjunto estiver incompleto)
```

## Conjunto de referência

Os pares de medicamentos que validam o motor são escolhidos e revisados pela farmacêutica. Formato,
regras e como preencher: [`docs/conjunto-de-referencia.md`](docs/conjunto-de-referencia.md).

## Fontes e licenças

- O código ainda não tem licença (todos os direitos reservados); decisão adiada na ADR 0004.
- Registro de medicamentos da ANVISA (dados abertos).
- DDInter, licença CC BY-NC-SA 4.0: uso não comercial, com atribuição, e a base derivada segue a
  mesma licença. Detalhes em [`docs/fontes/ddinter.md`](docs/fontes/ddinter.md) e
  [`docs/adr/0004-finalidade-e-licencas.md`](docs/adr/0004-finalidade-e-licencas.md).
