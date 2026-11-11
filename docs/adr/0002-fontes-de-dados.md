# 0002 · Fontes de dados

- **Status:** Proposta (2026-11-11)
- **Decisor:** Edu

## Contexto

A referência atual da farmacêutica é uma ferramenta interna, sem acesso para nós. Precisamos de
fontes abertas, reproduzíveis e com licença compatível com o uso do projeto.

## Decisão

- **ANVISA, dados abertos de medicamentos registrados:** nomes comerciais, composição e número de
  registro.
- **DDInter 2.0:** interações com gravidade, mecanismo e manejo; também alimento, doença e
  duplicidade terapêutica.
- Ambas entram por **download de arquivos**, versionados com data, endereço e checksum. Não foi
  confirmada uma API oficial estável do DDInter.
- Todo registro guarda **proveniência**: fonte, versão e data.
- O pipeline roda do zero com um comando e é idempotente.

## Alternativas consideradas

Outras bases citadas na discussão (RxNorm, openFDA, PubChem, DrugBank, Bulário, Detecta Interações)
não fazem parte da v1. Podem complementar a ANVISA e o DDInter numa fase posterior, cada uma com sua
própria ADR e verificação de licença.

## Consequências

- O DDInter tem cobertura limitada (por exemplo, 29 alimentos); isso é comunicado no app.
- Maior risco: **falso negativo** por cobertura. Mitigação: conjunto de referência da farmacêutica e
  mensagem fixa "ausência não é segurança" (ver [aviso de uso](../AVISO.md)).
- Os nomes em inglês do DDInter precisam ser ligados aos nomes em português da ANVISA por um
  mapeamento com revisão (Fase 2).
