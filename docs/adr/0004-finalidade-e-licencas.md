# 0004 · Finalidade, licenças e aviso

- **Status:** Aceita (2026-11-12)
- **Decisor:** Edu

## Contexto

O app é para estudo e uso profissional da esposa do Edu, sem intenção de publicar ou vender, e também
alimenta o portfólio. O DDInter 2.0 é distribuído sob CC BY-NC-SA 4.0. A RDC 657/2022 da Anvisa
regula software como dispositivo médico.

## Decisão

- **Finalidade:** estudo e uso pessoal; sem venda, sem contas e **sem cadastro de pacientes na v1**.
- **Licença dos dados:** a base derivada do DDInter fica sob **CC BY-NC-SA 4.0**: uso não comercial,
  atribuição e mesma licença. O app tem tela de créditos e o repositório tem arquivo de avisos com a
  atribuição das fontes.
- **Aviso de uso** em [`docs/AVISO.md`](../AVISO.md), incluindo a mensagem fixa de que ausência de
  ocorrência não é segurança.
- **Regulatório:** o projeto permanece de estudo. Se a finalidade mudar, o enquadramento na RDC
  657/2022 é reavaliado **antes**, com apoio do CRF. Isto não é aconselhamento jurídico.

## Decisões adiadas

1. **Base derivada no repositório público:** por enquanto a base derivada do DDInter **não** é
   versionada no repositório; só o código do pipeline. Reabrir antes de publicar o repositório.
2. **Licença do código:** nenhuma por ora, ou seja, todos os direitos reservados (os dados seguem as
   licenças das fontes). Para uso não comercial do DDInter não é preciso pedir licença, só atribuir e
   manter a mesma licença na base derivada; pedir autorização só entra se o uso virar comercial.

## Consequências

- Uso comercial fica fora de escopo enquanto o DDInter for fonte.
- Distribuir a terceiros ou incluir pacientes muda a finalidade e reabre esta ADR.
