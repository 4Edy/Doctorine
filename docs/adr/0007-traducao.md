# 0007 · Tradução dos textos clínicos

- **Status:** Proposta (2026-11-16). Vira Aceita depois da aprovação do Edu.
- **Decisor:** Edu

## Contexto

O P8 leva ~8,4 mil textos distintos de mecanismo e manejo do DDInter (mais alimento e doença) para o
português. O plano exige: tradução única por texto, status de revisão visível, glossário aprovado
pela farmacêutica, nomes de fármacos nunca traduzidos automaticamente e histórico de versões. Detalhes
em [`docs/traducao.md`](../traducao.md).

## Decisão

1. **Unidade = texto distinto em inglês**, identificado pelo SHA-256 do texto normalizado. Muda o
   inglês, muda o id: a tradução antiga não é reaproveitada em silêncio.
2. **Nomes de fármacos viram marcadores** (`[[F1]]`) antes da tradução e a tradução é rejeitada se
   perder, repetir ou inventar um marcador. O nome em português vem do mapeamento (P7).
3. **Memória de eventos** que só cresce, com três status (`nao-revisado`, `revisado`, `corrigido`).
   Rascunho de IA é sempre `nao-revisado` e nunca sobrescreve texto revisado.
4. **Glossário versionado** no repositório, com `status` por termo. Termo proposto falha como aviso,
   aprovado como erro. O identificador do glossário vigente é gravado em cada evento.
5. **Dois caminhos de rascunho com a mesma validação:** lote exportado/importado por arquivo e
   chamada direta à API. A tradução por IA nunca é fonte clínica.
6. **Nada é "corrigido" em silêncio:** o que reprova não é gravado nem ajustado.

## Alternativas consideradas

- **Traduzir só na hora de mostrar (no app):** descartada; exige IA ou rede no aparelho e perde a
  revisão.
- **Chave por (par, campo):** descartada; o manejo é por texto (50 de 50 amostras iguais) e traduziria
  o mesmo texto milhares de vezes.
- **Aceitar tradução que mexe no nome do fármaco e corrigir depois:** descartada; é o erro silencioso
  que o plano quer evitar.
- **Memória em SQLite:** adiada; JSONL só de acréscimo é simples de conferir e de fazer backup, e o P9
  decide se vale migrar.

## Consequências

- O rascunho é barato de refazer e de validar, mas **a qualidade clínica depende da revisão**
  (P9). Até lá, todo texto aparece como não revisado.
- A memória é obra derivada do DDInter (CC BY-NC-SA 4.0). `memoria.jsonl` fica **fora do git** por
  ora, junto com a decisão em aberto da ADR 0004 sobre a base derivada. Isso exige backup à parte.
- Texto cujo inglês mudar na fonte volta à fila e a tradução antiga fica órfã.

## Pontos a confirmar

- Incluir `memoria.jsonl` no repositório público (mesma licença da base derivada) ou manter fora.
- Escopo: referências, nomes de alimentos e de doenças e duplicidade ficam para o P9 (vocabulário)?
- Rascunho por API (custo em tokens) ou só por lotes importados.
- Quem aprova o glossário (a farmacêutica, pela ferramenta do P9) e em que momento.
