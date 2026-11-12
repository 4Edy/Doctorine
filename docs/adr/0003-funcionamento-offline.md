# 0003 · Funcionamento offline

- **Status:** Aceita (2026-11-12)
- **Decisor:** Edu

## Contexto

O Edu acha interessante o app funcionar offline, mas queria avaliar se vale a pena. Offline também
elimina servidor, custo de hospedagem e envio de dados.

## Decisão

- A base é gerada pelo pipeline como **arquivo SQLite versionado** e embarcada no app. Não há backend
  em produção no MVP.
- A análise roda inteira no aparelho, com o motor compartilhado.
- **Teste de decisão no início da Fase 5**, em Android intermediário. Metas propostas, a combinar:
  busca em até 300 ms e análise de 10 medicamentos em até 2 s, além de medir o tamanho do arquivo.
- Se o teste falhar, voltamos a discutir um servidor.

## Alternativas consideradas

- **API própria:** exige hospedagem, manutenção e envio dos medicamentos consultados.
- **Híbrido (offline com sincronização):** complexidade sem necessidade na v1.

## Consequências

- Atualizar a base significa publicar uma nova versão do arquivo; o app precisa preservar o histórico
  local ao trocá-lo (testado na Fase 6).
- Sem rede em uso normal: a Fase 6 verifica a ausência de chamadas de rede.
- Se uma camada de IA entrar (Fase 7), a escolha entre modelo local e em nuvem reabre este ponto.
