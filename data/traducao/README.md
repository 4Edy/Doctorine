# data/traducao

Dados do P8 (tradução). Formato e fluxo em [`docs/traducao.md`](../../docs/traducao.md).

- `glossario.json` (versionado): termos farmacológicos em inglês e a tradução adotada, cada um
  `proposto` ou `aprovado`.
- `memoria.jsonl` (fora do git por ora): uma linha por evento de tradução (rascunho, revisão,
  correção), só cresce. Fica fora do git porque a tradução é obra derivada do DDInter
  (CC BY-NC-SA 4.0) e a ADR 0004 deixou em aberto o que entra no repositório público; veja a
  ADR 0007. **Faça backup deste arquivo**: ele guarda as revisões da farmacêutica.
- `lotes/` (fora do git): lotes exportados para traduzir fora da API.
- `nomes-pt.json` (fora do git, opcional): mapa `{"DDInter123": "nome em português"}` com os
  nomes do mapeamento (P7), usado só para mostrar um texto com os nomes restaurados.
