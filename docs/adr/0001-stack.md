# 0001 · Stack

- **Status:** Proposta (2026-11-11). A escolha da stack foi aprovada na discussão do P1; esta ADR
  registra por escrito e aguarda a aprovação final.
- **Decisor:** Edu

## Contexto

O projeto serve a uma farmacêutica e também ao portfólio do Edu. Precisa rodar offline em Android,
ter um motor de análise determinístico e testável, e reaproveitar o mesmo código no pipeline que gera
a base e no app que a consulta.

## Decisão

| Camada           | Escolha                                                             |
| ---------------- | ------------------------------------------------------------------- |
| Linguagem        | TypeScript em tudo (pipeline, motor e app)                          |
| Mobile           | Expo (React Native)                                                 |
| Motor de análise | Pacote compartilhado entre o pipeline e o app                       |
| Banco            | SQLite no aparelho, com FTS5 para busca por nome                    |
| Acesso a dados   | Drizzle                                                             |
| Validação        | Zod                                                                 |
| Testes           | Vitest (unitários e de propriedade), Maestro (ponta a ponta no app) |
| Integração       | GitHub Actions e Docker                                             |
| Monorepo         | pnpm workspaces                                                     |

## Alternativas consideradas

- **Flutter, Kotlin nativo, React Native sem Expo:** não compartilham código com o pipeline em
  TypeScript.
- **React + Capacitor** (reaproveitando o protótipo do Lovable): alternativa pragmática, descartada
  por ora; segue possível se o Expo atrapalhar.
- **PWA:** SQLite no navegador é menos previsível para uma base grande offline.
- **Python no pipeline:** bom para dados, mas separa o motor em duas linguagens e exigiria um teste de
  paridade entre elas.
- **PostgreSQL / MongoDB:** só fariam sentido com servidor; MongoDB descartado.
- **Prisma, Kysely, Jest, Valibot, Detox:** sem vantagem clara sobre as escolhas acima para este
  projeto.

## Consequências

- Um único ecossistema; o motor roda igual no pipeline (testes) e no app (produção).
- Depende de o Expo atender ao desempenho exigido pelo ADR 0003; o teste de decisão da Fase 5 confirma.
- Mudanças recebidas como arquivos `.patch`, um por etapa do plano.
